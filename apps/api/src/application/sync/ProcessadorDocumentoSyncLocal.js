import { extrairDataEmissao, camposDataEmissao, interpretarDataOriginal } from "../notas/dataEmissaoNota.js";
import { prepararDocumentoNota, bloquearDocumentosDaEmpresa, conferirIdentidadeDocumento, chaveCanonica, conflitoDocumental } from "../notas/persistirDocumentoNota.js";
import { registrarPendenciaDoPeriodo, situacaoDoPeriodo, mesFiscal } from "../notas/pendenciasDoPeriodo.js";
import { isMonthClosed, bloquearFechamentoContabil } from '../accounting/fechamentoContabil.js';
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { prisma } from "../../infrastructure/db/prisma.js";
import { parseXmlMetadata } from "../nfse/AdnXmlMetadata.js";
import { camposFiscaisParaPersistir } from "../nfse/camposFiscaisNfse.js";
import { parseDate } from "../../utils/date.js";

function normalizeCnpj(value) {
  return String(value || "").replace(/\D+/g, "");
}

function sha256(text) {
  if (!text) return null;
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function decodeXml(arquivoXml) {
  if (!arquivoXml) return null;
  const raw = Buffer.from(String(arquivoXml), "base64");
  try {
    return gunzipSync(raw).toString("utf-8");
  } catch {
    return raw.toString("utf-8");
  }
}

function mapInvoiceStatusFromAdn({ tipoDocumento, tipoEvento, situacao, statusNormalized }) {
  const td = String(tipoDocumento || "").toUpperCase();
  const te = String(tipoEvento || "").toUpperCase();
  const si = String(situacao || "").trim().toLowerCase();
  const st = String(statusNormalized || "").toLowerCase();

  // EVENTOS devem ter prioridade sobre qualquer cStat/situacao do XML.
  if (te.includes("E105102")) return "SUBSTITUIDA";
  if (te.includes("E101101")) return "CANCELADA";
  if (td === "EVENTO") {
    if (te.includes("SUBSTIT")) return "SUBSTITUIDA";
    if (te.includes("CANCEL")) return "CANCELADA";
    if (te.includes("REJEIT") || te.includes("REJECT")) return "REJEITADA";
  }

  if (st === "cancelled_substitution") return "SUBSTITUIDA";
  if (st === "cancelled") return "CANCELADA";
  if (st === "rejected") return "REJEITADA";
  if (st === "authorized") return "EMITIDA";

  // cStat comum em retornos XML transformados
  // 100: autorizada
  // 101/102: cancelamento (varia por implementação/provedor)
  if (si === "100") return "EMITIDA";
  if (si === "101" || si === "102") return "CANCELADA";

  if (si === "2") return "CANCELADA";
  if (si === "1") return "EMITIDA";

  if (si.includes("substit")) return "SUBSTITUIDA";
  if (si.includes("cancel")) return "CANCELADA";
  if (si.includes("rejeit") || si.includes("reject")) return "REJEITADA";
  if (si.includes("autoriz") || si.includes("normal")) return "EMITIDA";

  return "PENDENTE";
}

function mergeStatus(existing, incoming) {
  const ex = String(existing || "").toUpperCase();
  const inc = String(incoming || "").toUpperCase();
  const priority = ["SUBSTITUIDA", "CANCELADA", "REJEITADA", "EMITIDA", "PENDENTE"];
  const exP = priority.indexOf(ex);
  const incP = priority.indexOf(inc);
  if (exP === -1) return inc || existing || "PENDENTE";
  if (incP === -1) return existing || "PENDENTE";
  return exP <= incP ? ex : inc;
}

async function findExistingPortalInvoice({ clientId, data, db = prisma }) {
  const found = new Map();
  for (const key of ['idDps', 'chaveAcesso', 'idNfse']) {
    if (!data[key]) continue;
    const values = key === 'chaveAcesso'
      ? [...new Set([data[key], chaveCanonica(data[key]), `${String(chaveCanonica(data[key])).length === 50 ? 'NFS' : 'NFe'}${chaveCanonica(data[key])}`])]
      : [data[key]];
    for (const value of values) {
      const row = await db.portalInvoice.findUnique({ where: { [`clientId_${key}`]: { clientId, [key]: value } } });
      if (row) {
        if (row.clientId !== clientId) throw conflitoDocumental();
        found.set(row.id, row);
      }
    }
  }
  if (found.size > 1) throw conflitoDocumental();
  return [...found.values()][0] || null;
}

async function buildSafeUpdateData({ clientId, existing, data, db }) {
  conferirIdentidadeDocumento(existing, data);
  const portal = await db.portalClient.findUnique({ where: { id: clientId }, select: { cnpj: true } });
  const { documentoPreservado, ...documento } = prepararDocumentoNota(existing, data, portal?.cnpj);
  const update = documentoPreservado ? { ...documento, status: mergeStatus(existing.status, data.status) }
    : { ...data, ...documento, status: mergeStatus(existing.status, data.status), issueDate: existing.issueDate, competencia: existing.competencia };
  for (const key of ['idDps', 'chaveAcesso', 'idNfse']) {
    if (!data[key]) delete update[key];
    else if (existing[key]) update[key] = existing[key];
  }
  return update;
}
async function conferirPeriodosDocumentais(db, clientId, existing, data) {
  const mes = value => value instanceof Date && !Number.isFinite(value.getTime()) ? null : mesFiscal(value);
  const metadata = parseXmlMetadata(data.xmlRaw || '');
  const literal = metadata.competenciaOriginal;
  const parsed = interpretarDataOriginal(literal, { somenteData: metadata.competenciaFormato === 'dCompet' });
  if (metadata.competenciaErro || (literal != null && parsed.motivo)) throw erroSync('COMPETENCIA_DOCUMENTAL_INVALIDA');
  const documental = parsed.civil?.slice(0, 7) || null;
  const informado = data.competencia == null ? documental : mes(data.competencia);
  const persistido = existing ? mes(existing.competencia) : null;
  const periodos = [...new Set([documental, informado, persistido].filter(Boolean))];
  for (const competencia of periodos) {
    if (await isMonthClosed(clientId, competencia, db)) {
      throw Object.assign(new Error('Mês contábil fechado. Use Corrigir mês fechado e confira a base antes de tentar novamente.'),
        { code: 'MES_CONTABIL_FECHADO_REQUER_REVISAO', status: 409 });
    }
  }
  // Never infer a competence from issueDate, nor accept missing document evidence.
  if (!documental || !informado || (existing && !persistido)) throw erroSync('COMPETENCIA_DOCUMENTAL_DESCONHECIDA');
  if (new Set(periodos).size !== 1) throw erroSync('COMPETENCIA_DOCUMENTAL_DIVERGENTE');
  if (existing && (await situacaoDoPeriodo(db, { portalClientId: clientId, competencia: persistido })).exigeRevisao) {
    throw erroSync('PERIODO_FISCAL_FECHADO_REQUER_REVISAO');
  }
  return new Date(`${parsed.civil}T00:00:00Z`);
}

export async function upsertPortalInvoiceSafe({ clientId, data, client = prisma, tx = null }) {
  if (data.clientId && data.clientId !== clientId) throw conflitoDocumental();
  data = { ...data, provenienciaDfe: undefined };
  if (data.chaveAcesso) data.chaveAcesso = chaveCanonica(data.chaveAcesso);
  conferirIdentidadeDocumento(null, data);
  // External capture is already finished. Retry only the local transaction.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const execute = tx ? cb => cb(tx) : cb => client.$transaction(cb);
      return await execute(async db => {
        await bloquearDocumentosDaEmpresa(db, clientId);
        await bloquearFechamentoContabil(db, clientId);
        const existing = await findExistingPortalInvoice({ clientId, data, db });
        if (existing) conferirIdentidadeDocumento(existing, data);
        const competenciaDocumental = await conferirPeriodosDocumentais(db, clientId, existing, data);
        if (existing) {
          const safeUpdate = await buildSafeUpdateData({ clientId, existing, data, db });
          const changed = await db.portalInvoice.updateMany({ where: { id: existing.id, clientId,
            updatedAt: existing.updatedAt, chaveAcesso: existing.chaveAcesso ?? null,
            idDps: existing.idDps ?? null, idNfse: existing.idNfse ?? null,
            xmlRaw: existing.xmlRaw ?? null, xmlResumo: existing.xmlResumo ?? null }, data: safeUpdate });
          if (changed.count !== 1) throw Object.assign(Error('Fonte alterada durante sincronização'), { code: 'FONTE_ALTERADA' });
          const invoice = await db.portalInvoice.findFirst({ where: { id: existing.id, clientId } });
          return { action: 'updated', invoiceId: existing.id, invoice };
        }
        const portal = await db.portalClient.findUnique({ where: { id: clientId }, select: { cnpj: true } });
        const { documentoPreservado, ...documento } = prepararDocumentoNota(null, data, portal?.cnpj);
        const invoice = await db.portalInvoice.create({ data: { ...data, competencia: data.competencia || competenciaDocumental, clientId, ...documento } });
        await registrarPendenciaDoPeriodo(db, { portalClientId: clientId, competencia: invoice.competencia,
          chaveAcesso: invoice.chaveAcesso, notaId: invoice.id, papel: invoice.papel, valor: invoice.total, origem: 'SINCRONIZACAO' });
        return { action: 'created', invoiceId: invoice.id, invoice };
      });
    } catch (error) {
      if (tx || !['P2002', 'P2034', 'FONTE_ALTERADA'].includes(error?.code) || attempt === 2) throw error;
    }
  }
}
// Versioned canonical JSON: snapshot, delivery and request have deliberately different hashes.
export function serializarCanonico(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(serializarCanonico).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + serializarCanonico(value[key])).join(',') + '}';
}
export const hashCanonico = value => crypto.createHash('sha256').update('sync-json-v1\n' + serializarCanonico(value)).digest('hex');
export const erroSync = (code, status = 409) => Object.assign(new Error(code), { code, status });
export function nsuDocumento(item) {
  const raw = item?.NSU ?? item?.nsu ?? item?.Nsu;
  // JSON numeric values beyond the safe range have already lost precision: never repair them.
  if ((typeof raw !== 'string' && typeof raw !== 'number') || (typeof raw === 'number' && !Number.isSafeInteger(raw))
    || !/^\d{1,30}$/.test(String(raw))) throw erroSync('DOCUMENTO_SEM_NSU');
  return BigInt(raw).toString();
}

// No transport/certificate/queue dependencies. Caller owns the complete transaction.
export async function processarDocumentoSyncLocal(tx, snapshot) {
  const { clientId, origem, item } = snapshot;
  if (!clientId || origem !== 'ADN_SYNC' || !item || typeof item !== 'object') throw erroSync('SNAPSHOT_INVALIDO');
  await bloquearDocumentosDaEmpresa(tx, clientId);
  const portal = await tx.portalClient.findUnique({ where: { id: clientId } });
  if (!portal) throw erroSync('CLIENT_NOT_FOUND', 404);
  const nsu = nsuDocumento(item);
  const tipoDocumento = item.TipoDocumento || item.tipoDocumento || null;
  const tipoEvento = item.TipoEvento || item.tipoEvento || null;
  const dataHoraGeracao = item.DataHoraGeracao || item.dataHoraGeracao || null;
  const chaveAcesso = chaveCanonica(item.ChaveAcesso || item.chaveAcesso);
  const arquivoXml = item.ArquivoXml || item.arquivoXml || null;
  const xmlRaw = arquivoXml ? decodeXml(arquivoXml) : null;
  const metadata = xmlRaw ? parseXmlMetadata(xmlRaw) : {};
  const status = mapInvoiceStatusFromAdn({ tipoDocumento, tipoEvento, situacao: metadata?.situacao });
  const conteudoHash = hashCanonico({ tipoDocumento, tipoEvento, dataHoraGeracao, chaveAcesso, xmlRaw });
  const identity = { clientId, origem, nsu };
  const saved = await tx.syncDocumentoEntrega.findUnique({ where: { clientId_origem_nsu: identity } });
  if (saved) {
    if (saved.conteudoHash !== conteudoHash || saved.chaveAcesso !== chaveAcesso) throw erroSync('NSU_CONTEUDO_CONFLITANTE');
    return { ...saved.resultado, action: 'duplicate', nsu };
  }
  const isEvento = String(tipoDocumento || '').toUpperCase() === 'EVENTO';
  const baseData = { clientId, type: 'NFSE', numero: metadata?.numeroNfse || null, serie: null,
    chaveAcesso, idNfse: metadata?.numeroNfse || null, idDps: null,
    competencia: metadata?.competencia || null, issueDate: metadata?.dataEmissao || null,
    status, total: metadata?.valorServicos ?? null,
    emitenteNome: metadata?.prestadorNome || null, emitenteDoc: metadata?.cnpjPrestador || null,
    tomadorNome: metadata?.tomadorNome || null, tomadorDoc: metadata?.cnpjTomador || null,
    xmlRaw, xmlHash: sha256(xmlRaw || ''), lastSyncAt: null };
  conferirIdentidadeDocumento(null, baseData);
  let eventId = null;
  let eventInvoice = null;
  if (isEvento) {
    if (!chaveAcesso) throw erroSync('EVENTO_SEM_IDENTIDADE');
    // Legacy events do not prove their delivery content. Do not duplicate or guess a match.
    const legacy = await tx.portalInvoiceEvent.findMany({ where: { clientId,
      payloadRaw: { path: ['nsu'], equals: nsu } } });
    const existing = await findExistingPortalInvoice({ clientId, data: baseData, db: tx });
    if (!existing) throw erroSync('EVENTO_NOTA_AUSENTE');
    conferirIdentidadeDocumento(existing, baseData);
    eventInvoice = existing;
    if (legacy.length) {
      const event = legacy[0];
      if (legacy.length !== 1 || event.invoiceId !== existing.id || event.payloadRaw?.origem !== origem
        || event.payloadRaw?.conteudoHash !== conteudoHash || chaveCanonica(event.payloadRaw?.chaveAcesso) !== chaveAcesso) {
        throw erroSync('EVENTO_LEGADO_REQUER_CONFERENCIA');
      }
      const outcome = { action: 'duplicate', invoiceId: existing.id, eventId: event.id, nsu };
      await tx.syncDocumentoEntrega.create({ data: { ...identity, conteudoHash, chaveAcesso,
        invoiceId: existing.id, eventId: event.id, resultado: outcome } });
      return outcome;
    }
  }
  if (!isEvento) {
    const evidence = extrairDataEmissao(xmlRaw);
    const companyDoc = normalizeCnpj(portal.cnpj);
    if (!companyDoc || ![evidence.emitenteDoc, evidence.tomadorDoc].map(normalizeCnpj).includes(companyDoc)) throw erroSync('EMPRESA_DIVERGENTE');
    if (!evidence.identidade) throw erroSync('DOCUMENTO_SEM_IDENTIDADE');
  }
  const data = isEvento ? baseData : { ...baseData,
    ...camposFiscaisParaPersistir(xmlRaw), ...camposDataEmissao(extrairDataEmissao(xmlRaw)) };
  let result;
  if (isEvento) {
    // Events can change status, never XML, values, competence or derived fields.
    // Even an event envelope containing a full invoice cannot replace the base.
    const changed = await tx.portalInvoice.updateMany({ where: { id: eventInvoice.id, clientId,
      updatedAt: eventInvoice.updatedAt, status: eventInvoice.status },
      data: { status: mergeStatus(eventInvoice.status, status) } });
    if (changed.count !== 1) throw erroSync('FONTE_ALTERADA');
    result = { action: 'updated', invoiceId: eventInvoice.id,
      invoice: { ...eventInvoice, status: mergeStatus(eventInvoice.status, status) } };
  } else result = await upsertPortalInvoiceSafe({ clientId, data, tx });
  if (isEvento) {
    const event = await tx.portalInvoiceEvent.create({ data: { clientId, invoiceId: result.invoiceId,
      type: result.invoice.status, date: dataHoraGeracao ? parseDate(dataHoraGeracao) : null,
      payloadRaw: { tipoDocumento, tipoEvento, nsu, origem, conteudoHash, chaveAcesso } } });
    eventId = event.id;
  }
  const outcome = { action: result.action, invoiceId: result.invoiceId, eventId, nsu };
  await tx.syncDocumentoEntrega.create({ data: { ...identity, conteudoHash, chaveAcesso,
    invoiceId: result.invoiceId, eventId, resultado: outcome } });
  return outcome;
}
