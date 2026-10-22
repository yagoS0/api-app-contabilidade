import { createHash, randomUUID } from 'node:crypto';
import { exigirGuiaArrecadatoria } from './lib/documentoNaoArrecadatorio.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import { versaoPagamentoGuia } from './ConfirmacaoPagamentoClienteService.js';

export const MEIOS_ENTREGA = ['PESSOAL', 'WHATSAPP_PARTICULAR', 'EMAIL_EXTERNO', 'OUTRO'];
export const revisaoEntrega = g => createHash('sha256').update(JSON.stringify([versaoPagamentoGuia(g), g.vencimento ? new Date(g.vencimento).toISOString() : null])).digest('hex');
const erro = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
export function documentoValido(g) {
  return g?.status === 'PROCESSED' && Boolean(g.hash) && g.extracted?.conferenciaDocumentoPendente !== true
    && ((g.pdfBytes?.length && Buffer.from(g.pdfBytes).subarray(0, 5).toString() === '%PDF-') || Boolean(g.storageKey));
}
export function entregaExternaVigente(envio, guia) {
  const prova = envio?.historicoTentativas?.find(t => t.id === envio.tentativaAtualId)?.snapshot;
  return envio?.canal === 'EXTERNO' && envio.status === 'declarado_externo' && documentoValido(guia) && prova?.atorId && prova?.registradoEm
    && prova.guideId === guia.id && prova.companyId === guia.portalClientId && prova.revisaoDocumento === revisaoEntrega(guia) ? prova : null;
}
export async function externaDaGuia(guia, db = prisma) {
  const e = await db.envioGuia.findFirst({ where: { guideId: guia.id, canal: 'EXTERNO' }, include: { historicoTentativas: true } });
  return entregaExternaVigente(e, guia);
}
// A reserva e a declaração usam o mesmo lock de linha. Nunca segurar uma transação durante I/O externo.
export async function reservarSemEntregaExterna(db, guias, reservar, reenvioExplicito = false) {
  const transacao = fn => typeof db.$transaction === 'function' ? db.$transaction(fn) : fn(db);
  return transacao(async tx => {
    for (const g of [...guias].sort((a, b) => a.id.localeCompare(b.id))) {
      const lock = await tx.guide.updateMany({ where: { id: g.id, updatedAt: g.updatedAt }, data: { updatedAt: g.updatedAt } });
      if (!lock.count) throw erro('GUIA_ALTERADA', 'A guia mudou. Atualize antes de enviar.');
      const atual = await tx.guide.findUnique({ where: { id: g.id } });
      exigirGuiaArrecadatoria(atual);
      if (!reenvioExplicito && await externaDaGuia(atual, tx)) throw erro('GUIA_ENTREGA_EXTERNA', 'Esta revisão já tem envio externo registrado.');
    }
    return reservar(tx);
  });
}
export function criarEntregaExternaGuia({ db = prisma, agora = () => new Date() } = {}) {
  async function autorizar(companyId, user, tx) {
    if (!user?.id || user.accountType !== 'FIRM') throw erro('forbidden', 'Acesso restrito ao escritório.', 403);
    const acesso = await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: user.id } } });
    if (acesso?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(acesso.role)) throw erro('forbidden', 'Acesso de contador necessário nesta empresa.', 403);
  }
  async function guia(companyId, guideId, tx) {
    const g = await tx.guide.findFirst({ where: { id: guideId, portalClientId: companyId } });
    if (!g) throw erro('guia_nao_encontrada', 'Guia não encontrada.', 404);
    if (!documentoValido(g)) throw erro('guia_indisponivel', 'Confira o documento válido antes de registrar a entrega.');
    return g;
  }
  async function conferirPdf(g) {
    const bytes = g.pdfBytes?.length ? Buffer.from(g.pdfBytes) : await (await import('./GuideService.js')).getGuidePdfBuffer(g);
    if (!bytes?.length || Buffer.from(bytes).subarray(0, 5).toString() !== '%PDF-') throw erro('guia_indisponivel', 'O PDF da guia não está disponível. Confira o documento antes de registrar a entrega.');
  }
  async function previa(companyId, guideId, user) {
    await autorizar(companyId, user, db); const g = await guia(companyId, guideId, db);
    await conferirPdf(g);
    return { guideId, companyId, competencia: g.competencia, tipo: g.tipo, revisaoDocumento: revisaoEntrega(g), entregaExterna: await externaDaGuia(g, db) };
  }
  async function registrar(companyId, guideId, user, body = {}) {
    await autorizar(companyId, user, db);
    const preparado = await guia(companyId, guideId, db);
    await conferirPdf(preparado);
    const hoje = agora().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const data = String(body.dataEntrega || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(Date.parse(`${data}T12:00:00Z`)) || new Date(`${data}T12:00:00Z`).toISOString().slice(0, 10) !== data || data > hoje
      || !MEIOS_ENTREGA.includes(body.meio) || body.confirmado !== true || !/^[\w-]{8,100}$/.test(body.idempotencyKey || '')) throw erro('entrega_invalida', 'Confira data, meio e confirmação da entrega.', 400);
    return db.$transaction(async tx => {
      await autorizar(companyId, user, tx);
      let g = await guia(companyId, guideId, tx);
      const lock = await tx.guide.updateMany({ where: { id: guideId, portalClientId: companyId, updatedAt: g.updatedAt }, data: { updatedAt: g.updatedAt } });
      if (!lock.count) throw erro('guia_alterada', 'A guia mudou. Atualize a prévia.');
      g = await guia(companyId, guideId, tx);
      if (String(preparado.updatedAt) !== String(g.updatedAt) || preparado.storageKey !== g.storageKey || body.revisaoDocumento !== revisaoEntrega(g)) throw erro('guia_alterada', 'O documento mudou. Confira a revisão atual.');
      const key = `guia:entrega-externa:${guideId}:${body.idempotencyKey}`;
      const repetido = await tx.appSetting.findUnique({ where: { key } });
      if (repetido) {
        if (repetido.value.revisaoDocumento !== body.revisaoDocumento || repetido.value.dataEntrega !== data || repetido.value.meio !== body.meio) throw erro('idempotencia_divergente', 'Esta confirmação já foi usada com outros dados.');
        return { ok: true, entregaExterna: repetido.value, jaRegistrada: true };
      }
      const anterior = await externaDaGuia(g, tx);
      if (anterior) return { ok: true, entregaExterna: anterior, jaRegistrada: true };
      if (g.emailStatus === 'SENDING' || await tx.envioGuia.findFirst({ where: { guideId, canal: { not: 'EXTERNO' }, status: 'enviando' } })) throw erro('envio_em_andamento', 'Há envio em andamento. Aguarde o resultado antes de registrar a entrega externa.');
      const prova = { id: randomUUID(), guideId, companyId, competencia: g.competencia, tipo: g.tipo, revisaoDocumento: body.revisaoDocumento,
        arquivoHash: g.hash, dataEntrega: data, meio: body.meio, atorId: user.id, atorNome: String(user.name || '').trim() || null, registradoEm: agora().toISOString(), origem: 'DECLARACAO_CONTADOR', reciboProvedor: false };
      const existente = await tx.envioGuia.findFirst({ where: { guideId, canal: 'EXTERNO' } });
      const envio = existente || await tx.envioGuia.create({ data: { guideId, canal: 'EXTERNO', status: 'declarado_externo' } });
      const tentativa = await tx.envioGuiaTentativa.create({ data: { envioGuiaId: envio.id, status: 'declarado_externo', snapshot: prova, arquivoSha256: g.hash } });
      await tx.envioGuia.update({ where: { id: envio.id }, data: { status: 'declarado_externo', tentativaAtualId: tentativa.id } });
      await tx.appSetting.create({ data: { key, value: prova } });
      return { ok: true, entregaExterna: prova, jaRegistrada: false };
    });
  }
  return { previa, registrar };
}
