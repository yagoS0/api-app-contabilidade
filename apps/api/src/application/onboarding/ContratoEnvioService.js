import { createHash } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { exigirEscopo } from './ComercialService.js';
import { exigirGestor } from './RecursosComerciaisService.js';
import { encerrado } from './LeadService.js';
import { OnboardingError } from './OnboardingService.js';
import { gerarContratoPdf } from './ContratoComercialPdf.js';
import { criarEnvioVinculadoComercial } from './EnvioVinculadoComercial.js';
import { conferirDiagnosticoDaProposta } from './PropostasComerciaisService.js';

export const hashComercial = v => createHash('sha256').update(JSON.stringify(v, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item)).digest('hex');
const erro = (code, message) => new OnboardingError(code, message, 409);

export async function carregarContratoParaEnvio(id, contratoId, user, db) {
  exigirGestor(user); const ficha = await exigirEscopo(id, user, db);
  if (encerrado(ficha)) throw erro('atendimento_encerrado', 'O atendimento está encerrado.');
  const contrato = await db.contratoComercial.findFirst({ where: { id: contratoId, onboardingId: id }, include: { proposta: true } });
  const p = contrato?.proposta;
  if (!contrato?.aprovadoEm || !['AGUARDANDO_ASSINATURA', 'ASSINADO_CONFERIDO'].includes(contrato.status) || p?.status !== 'ACEITA' || p.revogadaEm || !p.opcaoAceita || contrato.dados?.opcao?.chave !== p.opcaoAceita) throw erro('contrato_indisponivel', 'Confira a versão do contrato da proposta aceita.');
  const modelo = await db.recursoComercial.findUnique({ where: { id: contrato.modeloId } });
  if (!modelo?.aprovadoEm || modelo.versao !== contrato.dados.modeloVersao) throw erro('modelo_alterado', 'O modelo do contrato mudou. Confira a versão aprovada.');
  await conferirDiagnosticoDaProposta(db, p);
  return { ficha, contrato, chave: hashComercial({ id, contratoId, propostaId: p.id, propostaVersao: p.versao, snapshot: p.snapshot, opcaoAceita: p.opcaoAceita, texto: contrato.texto, dados: contrato.dados, aprovadoEm: contrato.aprovadoEm, modeloVersao: modelo.versao, cadastroRevisao: ficha.dados?.cadastroRevisao || 0 }) };
}

export function criarContratoEnvio({ db = prisma, gerarPdf = gerarContratoPdf, ...deps } = {}) {
  const envio = criarEnvioVinculadoComercial({ db, ...deps });
  async function carregar(id, contratoId, user) { const ctx = await carregarContratoParaEnvio(id, contratoId, user, db); return { contratoId, conteudoHash: ctx.chave, envio: await envio.estado(ctx.chave) }; }
  async function enviar(id, contratoId, user, body = {}) {
    const ctx = await carregarContratoParaEnvio(id, contratoId, user, db);
    if (body.conteudoHash !== ctx.chave) throw erro('contrato_alterado', 'Abra e confira o contrato atual antes de enviar.');
    return envio.enviar({ id, user, chave: ctx.chave, conversaId: body.conversaId, referencia: { tipo: 'CONTRATO_COMERCIAL', contratoId, propostaId: ctx.contrato.propostaId },
      conferirContexto: async () => { if ((await carregarContratoParaEnvio(id, contratoId, user, db)).chave !== ctx.chave) throw erro('contrato_alterado', 'O contrato mudou durante a preparação.'); },
      preparar: async () => ({ pdf: await gerarPdf(ctx.contrato), nome: 'contrato-altan.pdf', texto: 'Contrato de prestação de serviços · ALTAN' }) });
  }
  return { carregar, enviar };
}
