import { createHash } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { encryptSecret } from '../../utils/crypto.js';
import { exigirEscopo } from './ComercialService.js';
import { exigirGestor } from './RecursosComerciaisService.js';
import { exigirConversaDoCaso } from './ContextoComercialService.js';
import { OnboardingError } from './OnboardingService.js';
import { encerrado } from './LeadService.js';

const erro = (code, message, status = 409) => new OnboardingError(code, message, status);
const hash = value => createHash('sha256').update(value).digest('hex');
const LIMITE = 5 * 1024 * 1024;
// An explicit copy into the encrypted onboarding archive, never reassigning the original
// WhatsApp file, conversation, company or participant. Existing conversion accepts PDFs.
export function criarDocumentosChatComercial({ db = prisma, cifrar = encryptSecret, agora = () => new Date() } = {}) {
  async function contexto(id, user, client = db) {
    exigirGestor(user); const ficha = await exigirEscopo(id, user, client);
    if (encerrado(ficha)) throw erro('atendimento_encerrado', 'Use os documentos da empresa para atendimentos encerrados.');
    const caso = await client.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null } });
    if (!caso) throw erro('atendimento_ausente', 'Vincule a conversa deste atendimento antes de selecionar documentos.');
    const conversa = await client.conversaWhatsapp.findUnique({ where: { id: caso.conversaId } });
    await exigirConversaDoCaso(caso, conversa, client);
    if (!caso.createdAt) throw erro('contexto_documental_indisponivel', 'Confira a data de abertura deste atendimento antes de vincular documentos.');
    return { ficha, caso, conversa };
  }
  function filtro(ctx) {
    return { portalClientId: null, estado: 'DISPONIVEL', mimeType: 'application/pdf', expiraEm: { gt: agora() }, tamanho: { lte: LIMITE },
      mensagem: { conversaId: ctx.conversa.id, direcao: 'in', registradaEm: { gte: ctx.caso.createdAt } } };
  }
  async function listar(id, user) {
    const ctx = await contexto(id, user);
    const arquivos = await db.arquivoWhatsapp.findMany({ where: filtro(ctx), orderBy: [{ recebidoEm: 'desc' }, { id: 'desc' }], take: 101,
      select: { id: true, mensagemId: true, nomeArquivo: true, tamanho: true, recebidoEm: true } });
    return { arquivos: arquivos.slice(0, 100), temMais: arquivos.length > 100, versao: ctx.ficha.versao };
  }
  async function vincular(id, user, body = {}) {
    if (typeof body.arquivoId !== 'string' || !body.arquivoId || !Number.isInteger(body.versao)) throw erro('documento_invalido', 'Selecione o arquivo recebido e a versão atual da ficha.', 400);
    const ctx = await contexto(id, user);
    const documentoId = `chat-${hash(id + ':' + body.arquivoId).slice(0, 40)}`;
    const anterior = await db.documentoOnboarding.findFirst({ where: { id: documentoId, onboardingId: id }, select: { id: true, nome: true, sha256: true } });
    if (anterior) return { documento: anterior, jaVinculado: true };
    if (ctx.ficha.versao !== body.versao) throw erro('formulario_alterado', 'A ficha mudou. Confira antes de vincular o documento.');
    const arquivo = await db.arquivoWhatsapp.findFirst({ where: { id: body.arquivoId, ...filtro(ctx) } });
    const buffer = arquivo?.conteudo && Buffer.from(arquivo.conteudo);
    if (!buffer?.length || buffer.length > LIMITE || buffer.subarray(0, 5).toString() !== '%PDF-') throw erro('arquivo_indisponivel', 'Selecione um PDF disponível de até 5 MB recebido neste atendimento.');
    const sha256 = hash(buffer);
    if (arquivo.sha256 && arquivo.sha256 !== sha256) throw erro('arquivo_divergente', 'O conteúdo recebido precisa ser conferido antes do vínculo.');
    const conteudoCifrado = await cifrar(buffer.toString('base64'));
    if (!conteudoCifrado) throw erro('cifra_indisponivel', 'Não foi possível proteger o documento.');
    return db.$transaction(async tx => {
      // Serializes copies in the same case without changing its business revision.
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: ['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'] } }, data: { updatedAt: agora() } });
      if (!reserva.count) throw erro('formulario_alterado', 'A ficha mudou durante o vínculo.');
      const atual = await contexto(id, user, tx);
      if (atual.caso.id !== ctx.caso.id || atual.conversa.id !== ctx.conversa.id || atual.conversa.telefoneE164 !== ctx.conversa.telefoneE164 || atual.conversa.vinculoNumeroId !== ctx.conversa.vinculoNumeroId) throw erro('atendimento_alterado', 'A identificação do atendimento mudou.');
      const duplicado = await tx.documentoOnboarding.findFirst({ where: { id: documentoId, onboardingId: id }, select: { id: true, nome: true, sha256: true } });
      if (duplicado) return { documento: duplicado, jaVinculado: true };
      const fonte = await tx.arquivoWhatsapp.findFirst({ where: { id: arquivo.id, ...filtro(atual) } });
      if (!fonte?.conteudo || hash(Buffer.from(fonte.conteudo)) !== sha256) throw erro('arquivo_alterado', 'O arquivo mudou ou expirou durante o vínculo.');
      const nome = String(arquivo.nomeArquivo || 'documento-whatsapp.pdf').replace(/[\u0000-\u001f\\/]/g, '_').slice(0, 180);
      const documento = await tx.documentoOnboarding.create({ data: { id: documentoId, onboardingId: id, nome, mime: 'application/pdf', conteudoCifrado, sha256, criadoPor: user.id }, select: { id: true, nome: true, sha256: true } });
      await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'DOCUMENTO_CHAT_VINCULADO', atorId: user.id,
        dados: { documentoId, arquivoWhatsappId: arquivo.id, mensagemId: arquivo.mensagemId, conversaId: ctx.conversa.id, atendimentoId: ctx.caso.id, origem: 'WHATSAPP', sha256 } } });
      return { documento, jaVinculado: false };
    });
  }
  return { listar, vincular };
}
