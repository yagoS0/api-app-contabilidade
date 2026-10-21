import { prisma } from '../../infrastructure/db/prisma.js';
import { decryptSecret } from '../../utils/crypto.js';
import * as contratacao from '../../../../../packages/shared/src/onboarding/contratacaoComercial.js';
import { OnboardingError } from './OnboardingService.js';
import { carregarContratoParaEnvio, hashComercial } from './ContratoEnvioService.js';
import { criarEnvioVinculadoComercial } from './EnvioVinculadoComercial.js';

const erro = (code, message) => new OnboardingError(code, message, 409);
export function criarCobrancaEnvio({ db = prisma, decifrar = decryptSecret, politica = contratacao, ...deps } = {}) {
  const envio = criarEnvioVinculadoComercial({ db, ...deps });
  async function contexto(id, user, body, client = db) {
    if (!Number.isInteger(body.versao) || typeof body.contratoId !== 'string' || typeof body.cobrancaId !== 'string') throw erro('cobranca_invalida', 'Selecione a cobrança salva e a versão atual.');
    const ctx = await carregarContratoParaEnvio(id, body.contratoId, user, client);
    if (ctx.ficha.versao !== body.versao) throw erro('formulario_alterado', 'A ficha mudou. Atualize antes de enviar a cobrança.');
    const cobranca = await client.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: 'COBRANCA_EXTERNA_REGISTRADA' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const d = cobranca?.dados;
    if (cobranca?.id !== body.cobrancaId || d?.contratoId !== ctx.contrato.id || d.propostaId !== ctx.contrato.propostaId || d.propostaVersao !== ctx.contrato.proposta.versao || d.contextoContrato !== politica.contextoContrato(ctx.contrato.proposta, ctx.contrato)) throw erro('cobranca_alterada', 'A cobrança ou o contrato mudou. Confira a cobrança atual.');
    const url = d.url ? politica.urlCobrancaSegura(d.url) : null;
    if (d.url && !url) throw erro('cobranca_invalida', 'O link salvo não é válido para envio.');
    let documento = null;
    if (d.documentoId) {
      documento = await client.documentoOnboarding.findFirst({ where: { id: d.documentoId, onboardingId: id } });
      if (!documento?.conteudoCifrado || documento.mime !== 'application/pdf') throw erro('documento_indisponivel', 'O documento da cobrança não está disponível nesta ficha.');
    }
    if (!url && !documento) throw erro('cobranca_invalida', 'A cobrança precisa de link ou documento.');
    return { ...ctx, cobranca, url, documento, chave: hashComercial({ contrato: ctx.chave, cobrancaId: cobranca.id, dados: d, documentoHash: documento?.sha256 || null }) };
  }
  async function enviar(id, user, body = {}) {
    if (!['ALTAN', 'EXTERNO'].includes(body.modo)) throw erro('modo_invalido', 'Selecione envio pelo Altan ou registro de envio externo.');
    const ctx = await contexto(id, user, body);
    if (body.modo === 'EXTERNO') {
      if (!['WHATSAPP', 'EMAIL', 'OUTRO'].includes(body.canal)) throw erro('canal_invalido', 'Informe o canal utilizado fora do Altan.');
      return db.$transaction(async tx => {
        const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: ['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'] } }, data: { updatedAt: new Date() } });
        if (!reserva.count) throw erro('formulario_alterado', 'A ficha mudou durante o registro.');
        if ((await contexto(id, user, body, tx)).chave !== ctx.chave) throw erro('cobranca_alterada', 'A cobrança mudou durante o registro.');
        const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: 'COBRANCA_ENVIO_EXTERNO_REGISTRADO', dados: { path: ['chave'], equals: ctx.chave } } });
        const registro = anterior || await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'COBRANCA_ENVIO_EXTERNO_REGISTRADO', atorId: user.id,
          dados: { chave: ctx.chave, cobrancaId: ctx.cobranca.id, contratoId: ctx.contrato.id, canal: body.canal, origem: 'DECLARACAO_CONTADOR', entregaComprovada: false, pagamentoConfirmado: false } } });
        return { registrado: true, registro, envio: { estado: 'INFORMADO_EXTERNAMENTE' }, pagamentoConfirmado: false };
      });
    }
    return envio.enviar({ id, user, chave: ctx.chave, conversaId: body.conversaId,
      referencia: { tipo: 'COBRANCA_COMERCIAL', cobrancaId: ctx.cobranca.id, contratoId: ctx.contrato.id },
      conferirContexto: async () => { if ((await contexto(id, user, body)).chave !== ctx.chave) throw erro('cobranca_alterada', 'A cobrança mudou durante a preparação.'); },
      preparar: async () => {
        let pdf;
        if (ctx.documento) {
          const plain = await decifrar(ctx.documento.conteudoCifrado); pdf = Buffer.from(plain || '', 'base64');
          // Hash computation is byte-based, matching DocumentoOnboarding.sha256.
          const { createHash } = await import('node:crypto');
          if (!pdf.length || pdf.length > 5 * 1024 * 1024 || pdf.subarray(0, 5).toString() !== '%PDF-' || createHash('sha256').update(pdf).digest('hex') !== ctx.documento.sha256) throw erro('documento_indisponivel', 'O documento da cobrança não pôde ser conferido.');
        }
        return { pdf, nome: ctx.documento?.nome || 'cobranca-altan.pdf', texto: 'Cobrança dos serviços contratados · ALTAN' + (ctx.url ? '\n' + ctx.url : '') };
      } });
  }
  return { enviar };
}
