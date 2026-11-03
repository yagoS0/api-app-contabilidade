import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { destinatariosDeEnvio } from '../whatsapp/ContatoWhatsappService.js';
import { versaoPagamentoGuia, listarConfirmacoesPagamento } from '../guides/ConfirmacaoPagamentoClienteService.js';
import { documentoValido, revisaoEntrega, reservarSemEntregaExterna } from '../guides/EntregaExternaGuiaService.js';
import { bloqueioEnvioParcela } from '../guides/GuiaParcelaEnvioGuard.js';
import { validateTransmissionContext } from './OperationsTransmissionDocuments.js';
import { revisaoDocumentoGuia } from '../whatsapp/EnvioDocumentoGuiaWhatsappService.js';
import { dataDoComprovante } from '../guides/lib/comprovantePagamento.js';

const fail = (message = 'A prévia mudou ou já foi utilizada. Confira novamente antes de enviar.', status = 409) => Object.assign(new Error(message), { status, code: 'OPERATIONS_PREVIEW_CHANGED' });
// PostgreSQL JSONB does not preserve object-key order. Sign semantic content.
const canonical = value => value?.toJSON ? canonical(value.toJSON()) : Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const key = token => `operations_guide_preview:${token}`;
const json = value => JSON.parse(JSON.stringify(value));
const iso = v => v ? new Date(v).toISOString() : null;
const amount = v => v == null || !Number.isFinite(Number(v)) ? null : Number(v);
const bytesHash = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const transportedRevision = g => digest([g.id, g.portalClientId, g.competencia, g.tipo, g.valor == null ? null : String(g.valor), iso(g.vencimento), g.hash || null, g.status, g.paymentStatus || null]);
const recipientView = r => ({ emails: [...r.emails].sort(), telefones: r.telefones.map(c => ({ id: c.id, telefoneE164: c.telefoneE164, vinculoNumeroId: c.vinculoNumeroId || null })).sort((a,b) => a.id.localeCompare(b.id)) });
// Includes the bytes/storage identity actually consumed, not a mutable timestamp changed by the worker.
export const operationsGuideRevision = g => digest([versaoPagamentoGuia(g), iso(g.vencimento), g.storageKey, g.sourcePath, g.driveFinalFileId, g.sourceFileId,
  g.pdfBytes ? digest(Buffer.from(g.pdfBytes).toString('base64')) : null, g.status, g.paymentStatus, g.clienteConfirmouEm, g.baixada,
  g.extracted?.conferenciaDocumentoPendente, g.parcelamento, g.parcela]);

async function authorize(db, userId, companyId, write = false) {
  const user = await db.user.findUnique({ where: { id: String(userId) } });
  if (user?.status !== 'active' || !(user.role === 'admin' || user.accountType === 'FIRM') || write && !['admin', 'contador'].includes(user.role)) throw fail('Acesso interno vigente não confirmado.', 403);
  if (user.role !== 'admin') {
    const link = await db.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: String(userId) } } });
    if (link?.status !== 'ACTIVE') throw fail('Seu acesso à empresa mudou.', 403);
  }
}
const getGuide = (db, companyId, competencia, guideId) => db.guide.findFirst({ where: { id: guideId, portalClientId: companyId, competencia }, include: { parcelamento: true, parcela: true } });
const safeCause = e => e?.erroCodigo ? 'Tentativa não concluída. Confira o histórico e o destinatário antes de repetir.' : null;

export function createOperationsGuideEvidence({ db = prisma, recipients = destinatariosDeEnvio, now = () => new Date() } = {}) {
  async function read({ userId, companyId, competencia, offset = 0 }) {
    validateTransmissionContext(companyId, competencia);
    if (!Number.isSafeInteger(offset) || offset < 0) throw fail('Página inválida.', 422);
    await authorize(db, userId, companyId);
    const guides = await db.guide.findMany({ where: { portalClientId: companyId, competencia }, orderBy: { id: 'asc' }, skip: offset, take: 51, include: { parcelamento: true, parcela: true } });
    const confirmations = await listarConfirmacoesPagamento(db, companyId);
    const items = [];
    for (const g of guides.slice(0, 50)) {
      const sends = await db.envioGuia.findMany({ where: { guideId: g.id }, orderBy: { id: 'asc' }, take: 51 });
      const attempts = await db.envioGuiaTentativa.findMany({ where: { envioGuia: { guideId: g.id } }, include: { envioGuia: true }, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], take: 51 });
      const current = confirmations.filter(c => c?.guideId === g.id && c.versaoGuia === versaoPagamentoGuia(g) && c.estadoBaixa !== 'SUBSTITUIDA');
      const confirmation = current.length === 1 ? current[0] : null;
      const official = g.paymentStatus === 'PAID' && g.paymentStatusSource === 'SERPRO' && g.parcela?.guiaId === g.id && g.parcela?.portalClientId === companyId
        && g.parcela?.pagamentoStatus === 'CONFIRMADO' && g.parcela?.pagamentoEvidencia?.resultado === 'CONFIRMADO' ? g.parcela : null;
      const receipt = g.paymentStatus === 'PAID' && g.paymentStatusSource === 'SERPRO' && g.extracted?.comprovante?.confiavel === true ? g.extracted.comprovante : null;
      const receiptDate = dataDoComprovante(receipt);
      items.push({ companyId, competencia, guideId: g.id, tipo: g.tipo, valor: amount(g.valor), revisao: operationsGuideRevision(g), estadoDocumental: g.status,
        pagamento: { status: g.paymentStatus || null, origem: g.paymentStatusSource || null, dataCivil: confirmation?.pagoEm || (official?.pagamentoEm ? iso(official.pagamentoEm).slice(0,10) : receiptDate ? iso(receiptDate).slice(0,10) : g.paymentStatus === 'PAID' && g.paymentStatusSource === 'MANUAL' && g.paymentConfirmedAt ? iso(g.paymentConfirmedAt).slice(0,10) : null),
          registradoEm: confirmation?.confirmadoEm || iso(official?.pagamentoConsultadoEm) || (g.paymentStatusSource === 'SERPRO' ? iso(g.serproLastCheckedAt) : null), valorPago: official ? amount(official.valorPago) : receipt ? amount(receipt.total) : null, proveniencia: confirmation ? 'CONFIRMACAO_CLIENTE' : official ? 'PARCELA_SERPRO' : receipt ? 'COMPROVANTE_SERPRO' : g.paymentStatusSource || null,
          estadoBaixa: confirmation?.estadoBaixa || (g.baixada ? 'CONCLUIDA' : null) },
        envios: sends.slice(0,50).map(e => ({ id: e.id, canal: e.canal, destino: e.destino, status: e.status, enviadoEm: iso(e.enviadoEm), entregueEm: iso(e.entregueEm), lidoEm: iso(e.lidoEm), causa: safeCause(e) })),
        tentativas: attempts.slice(0,50).map(t => ({ id: t.id, canal: t.envioGuia.canal, destino: t.envioGuia.destino, status: t.status, criadoEm: iso(t.criadoEm), aceitoEm: iso(t.aceitoEm), entregueEm: iso(t.entregueEm), lidoEm: iso(t.lidoEm), causa: safeCause(t),
          revisaoCompativel: !t.snapshot ? null : t.snapshot?.guideId === g.id && (t.snapshot?.companyId === companyId && t.snapshot?.revisaoDocumento === revisaoEntrega(g)
            || t.snapshot?.portalClientId === companyId && t.snapshot?.revisaoDocumento === revisaoDocumentoGuia(g)) })),
        historicoLimitado: sends.length > 50 || attempts.length > 50 });
    }
    return { companyId, competencia, items, offset, nextOffset: guides.length > 50 ? offset + 50 : null };
  }
  async function inspect(database, companyId, competencia, input, whatsappRequested) {
    const g = await getGuide(database, companyId, competencia, input.guideId);
    if (!g || !documentoValido(g) || g.paymentStatus === 'PAID' || g.clienteConfirmouEm || bloqueioEnvioParcela(g)) throw fail('Documento indisponível, pago ou pendente de conferência.');
    const recipientsNow = recipientView(await recipients(companyId));
    const canais = input.reenviarConfirmado && whatsappRequested ? ['WHATSAPP'] : ['EMAIL', ...(whatsappRequested ? ['WHATSAPP'] : [])];
    if (!canais.some(c => c === 'EMAIL' ? recipientsNow.emails.length : recipientsNow.telefones.length)) throw fail('Cadastre um destinatário autorizado antes de enviar.');
    const arquivoHash = g.pdfBytes?.length ? bytesHash(g.pdfBytes) : /^[a-f0-9]{64}$/.test(g.hash || '') ? g.hash : null;
    if (!arquivoHash) throw fail('A identidade do arquivo precisa de conferência antes do envio.');
    return { guideId: g.id, revisao: operationsGuideRevision(g), transporteRevision: transportedRevision(g), arquivoHash, reenviarConfirmado: input.reenviarConfirmado === true, canais, destinatarios: recipientsNow };
  }
  async function uncertainDispatch(database, companyId, guideId, canais, ownClaim = null) {
    for (const canal of canais) {
      const rows = await database.appSetting.findMany({ where: { key: { startsWith: 'operations_guide_preview:' }, AND: [
        { value: { path: ['companyId'], equals: companyId } },
        { value: { path: ['dispatches', guideId, canal, 'status'], equals: 'INICIADO' } },
      ] }, select: { value: true } });
      if (rows.some(r => r.value?.claim !== ownClaim)) throw fail('Existe envio sem desfecho. Concilie o histórico antes de repetir.');
    }
  }
  async function uncertainDelivery(database, companyId, competencia, item) {
    await uncertainDispatch(database, companyId, item.guideId, item.canais);
    const uncertain = await database.envioGuia.findFirst({ where: { guideId: item.guideId, status: { in: ['enviando', 'indeterminado'] } } });
    const guide = await getGuide(database, companyId, competencia, item.guideId);
    if (uncertain || guide.emailStatus === 'SENDING') throw fail('Existe envio sem desfecho. Concilie o histórico antes de repetir.');
  }
  async function preview({ userId, companyId, competencia, items, whatsappRequested = false }) {
    validateTransmissionContext(companyId, competencia);
    await authorize(db, userId, companyId, true);
    if (!Array.isArray(items) || !items.length || items.length > 100 || new Set(items.map(i => i?.guideId)).size !== items.length) throw fail('Selecione de 1 a 100 guias distintas.', 422);
    const accepted = [], refused = [];
    for (const input of items) {
      try {
        const item = await inspect(db, companyId, competencia, input, whatsappRequested);
        await uncertainDelivery(db, companyId, competencia, item);
        accepted.push(item);
      } catch (e) { refused.push({ guideId: input?.guideId || null, motivo: e.status ? e.message : 'Não foi possível conferir esta guia.' }); }
    }
    const token = randomUUID(), expiresAt = new Date(now().getTime() + 10 * 60_000).toISOString();
    const value = { userId, companyId, competencia, items: accepted, whatsappRequested: whatsappRequested === true, expiresAt, state: 'PREVIEW' };
    if (accepted.length) await db.appSetting.create({ data: { key: key(token), value: json(value) } });
    return { token: accepted.length ? token : null, companyId, competencia, items: accepted, refused, expiresAt, custo: 'Envio pelos canais conferidos; aceite não comprova entrega.' };
  }
  async function reserve({ token, userId, companyId, competencia, items, whatsappRequested = false }) {
    if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw fail();
    const claim = randomUUID();
    const saved = await db.$transaction(async tx => {
      await authorize(tx, userId, companyId, true);
      const value = (await tx.appSetting.findUnique({ where: { key: key(token) } }))?.value;
      if (!value || value.state !== 'PREVIEW' || value.userId !== userId || value.companyId !== companyId || value.competencia !== competencia || value.whatsappRequested !== whatsappRequested || new Date(value.expiresAt) <= now()) throw fail();
      const selection = input => input.map(i => [i.guideId, i.reenviarConfirmado === true]);
      if (JSON.stringify(selection(value.items)) !== JSON.stringify(selection(items))) throw fail();
      for (const expected of value.items) {
        if (digest(await inspect(tx, companyId, competencia, expected, whatsappRequested)) !== digest(expected)) throw fail();
        await uncertainDelivery(tx, companyId, competencia, expected);
      }
      await tx.appSetting.update({ where: { key: key(token) }, data: { value: { ...value, state: 'RESERVED', claim } } });
      return value;
    }, { isolationLevel: 'Serializable', timeout: 20000 });
    // Internal capability only. HTTP input never supplies a callback or waives the persisted claim.
    async function verify(database, { guide, canal, destino, pdfBytes }) {
      await authorize(database, userId, companyId, true);
      const row = (await database.appSetting.findUnique({ where: { key: key(token) } }))?.value;
      if (row?.claim !== claim || row.state !== 'RESERVED' || row.userId !== userId || row.companyId !== companyId || row.competencia !== competencia || digest(row.items) !== digest(saved.items) || new Date(row.expiresAt) <= now()) throw fail();
      const expected = saved.items.find(i => i.guideId === guide?.id);
      if (!expected || !expected.canais.includes(canal) || guide.portalClientId !== companyId || guide.competencia !== competencia) throw fail();
      if (transportedRevision(guide) !== expected.transporteRevision || pdfBytes && bytesHash(pdfBytes) !== expected.arquivoHash) throw fail();
      if (digest(await inspect(database, companyId, competencia, expected, whatsappRequested)) !== digest(expected)) throw fail();
      const reservation = row.emailReservations?.[guide.id];
      if (canal === 'EMAIL' && reservation) {
        const current = await getGuide(database, companyId, competencia, guide.id);
        if (current.emailStatus !== 'SENDING' || iso(current.updatedAt) !== reservation.updatedAt || current.emailAttempts !== reservation.attempts
          || iso(guide.updatedAt) !== reservation.updatedAt || guide.emailAttempts !== reservation.attempts) throw fail();
      }
      if (destino && (canal === 'WHATSAPP' ? !expected.destinatarios.telefones.some(c => c.telefoneE164 === destino) : JSON.stringify(String(destino).split(',').map(s=>s.trim().toLowerCase()).sort()) !== JSON.stringify(expected.destinatarios.emails))) throw fail();
      await uncertainDispatch(database, companyId, guide.id, [canal], claim);
      return { row, expected };
    }
    return {
      beforeDispatch: args => verify(db, args),
      // Same document row lock as the existing delivery reservation; the claim and own SENDING
      // are committed together. A caller never supplies a database or an ownership waiver.
      async reserveEmail(args, reserveGuide) {
        if (args.canal !== 'EMAIL') throw fail();
        return db.$transaction(tx => reservarSemEntregaExterna(tx, [args.guide], async locked => {
          const { row, expected } = await verify(locked, args);
          if (row.emailReservations?.[args.guide.id]) throw fail();
          await uncertainDelivery(locked, companyId, competencia, expected);
          const source = await reserveGuide(locked);
          if (source.id !== args.guide.id || source.portalClientId !== companyId || source.competencia !== competencia
            || source.emailStatus !== 'SENDING' || !source.updatedAt || !Number.isSafeInteger(source.emailAttempts)) throw fail();
          await locked.appSetting.update({ where: { key: key(token) }, data: { value: { ...row,
            emailReservations: { ...row.emailReservations, [source.id]: { updatedAt: iso(source.updatedAt), attempts: source.emailAttempts } } } } });
          return source;
        }), { isolationLevel: 'Serializable', timeout: 20000 });
      },
      // Called by EmailService's existing post-auth/MIME callback, immediately before HTTP/SMTP.
      async beginDispatch(args) {
        if (args.canal !== 'EMAIL' || !args.pdfBytes?.length) throw fail();
        await db.$transaction(async tx => {
          const { row, expected } = await verify(tx, args);
          if (!row.emailReservations?.[args.guide.id]) throw fail();
          if (row.dispatches?.[args.guide.id]?.EMAIL) throw fail();
          // Serializable predicate read + update rejects competing tokens, not only replay of one token.
          await uncertainDispatch(tx, companyId, args.guide.id, ['EMAIL']);
          const dispatch = { status: 'INICIADO', iniciadoEm: now().toISOString(), revisao: expected.revisao };
          await tx.appSetting.update({ where: { key: key(token) }, data: { value: { ...row, dispatches: { ...row.dispatches,
            [args.guide.id]: { ...row.dispatches?.[args.guide.id], EMAIL: dispatch } } } } });
        }, { isolationLevel: 'Serializable', timeout: 20000 });
      },
      async completeDispatch({ guideId, receipt }) {
        const expected = saved.items.find(i => i.guideId === guideId);
        const accepted = Array.isArray(receipt?.accepted) ? receipt.accepted.map(v => String(v).trim().toLowerCase()) : [];
        const proven = typeof receipt?.id === 'string' && receipt.id.length > 0 || typeof receipt?.messageId === 'string' && receipt.messageId.length > 0
          && expected?.destinatarios.emails.length > 0 && expected.destinatarios.emails.every(e => accepted.includes(e)) && !receipt.rejected?.length;
        if (!proven) throw fail('O provedor não confirmou integralmente o aceite. Concilie antes de repetir.');
        await db.$transaction(async tx => {
          const row = (await tx.appSetting.findUnique({ where: { key: key(token) } }))?.value;
          const dispatch = row?.dispatches?.[guideId]?.EMAIL;
          if (row?.claim !== claim || row.state !== 'RESERVED' || dispatch?.status !== 'INICIADO') throw fail();
          await tx.appSetting.update({ where: { key: key(token) }, data: { value: { ...row, dispatches: { ...row.dispatches,
            [guideId]: { ...row.dispatches[guideId], EMAIL: { ...dispatch, status: 'ACEITO', aceitoEm: now().toISOString() } } } } } });
        }, { isolationLevel: 'Serializable', timeout: 20000 });
      },
    };
  }
  return { read, preview, reserve };
}
