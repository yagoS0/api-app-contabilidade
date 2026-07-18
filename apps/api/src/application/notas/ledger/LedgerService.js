// Robustez NFS-e/ADN — Fase 1: primitivas do ledger append-only.
// Documentos e eventos são IMUTÁVEIS: re-append é no-op (nunca UPDATE destrutivo). O watermark
// avança só pra frente e deve ser gravado DENTRO da mesma $transaction dos appends (persiste →
// confirma → avança; nunca o contrário). Ainda NÃO ligado à captura atual (PortalInvoice intacto).

import { prisma } from "../../../infrastructure/db/prisma.js";

// competencia YYYY-MM a partir da data de emissão (UTC).
export function derivarCompetencia(dataEmissao) {
  if (!dataEmissao) return null;
  const d = new Date(dataEmissao);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toBigIntOrNull(v) {
  return v != null && v !== "" ? BigInt(v) : null;
}

// Append idempotente de um documento (dedupe por (portalClientId, chaveAcesso)). Re-append da
// mesma chave é no-op — o ledger é imutável, então nunca sobrescreve. Retorna { documento, created }.
export async function appendDocumento(doc, tx = prisma) {
  const portalClientId = doc?.portalClientId;
  const chaveAcesso = doc?.chaveAcesso;
  if (!portalClientId || !chaveAcesso) {
    const e = new Error("portalClientId e chaveAcesso são obrigatórios"); e.code = "INVALID_INPUT"; throw e;
  }
  const where = { portalClientId_chaveAcesso: { portalClientId, chaveAcesso } };
  const before = await tx.documento.findUnique({ where, select: { id: true } });
  const documento = await tx.documento.upsert({
    where,
    update: {}, // imutável: nunca sobrescreve um documento já capturado
    create: {
      portalClientId,
      chaveAcesso,
      cnpjPrestador: doc.cnpjPrestador ?? null,
      cnpjTomador: doc.cnpjTomador ?? null,
      municipioIbge: doc.municipioIbge ?? null,
      numeroNfse: doc.numeroNfse ?? null,
      dataEmissao: doc.dataEmissao ?? null,
      dataRecepcaoAdn: doc.dataRecepcaoAdn ?? null,
      competencia: doc.competencia ?? derivarCompetencia(doc.dataEmissao),
      valorServico: doc.valorServico ?? null,
      xmlOriginal: doc.xmlOriginal ?? null,
      nsuOrigem: toBigIntOrNull(doc.nsuOrigem),
      fonte: doc.fonte || "MANUAL",
    },
  });
  return { documento, created: !before };
}

// Append idempotente de um evento (dedupe por (chaveAcesso, tipoEvento, nSeqEvento)). Grava MESMO
// sem o documento existir — resolve o caso "evento chegou antes da nota" (hoje descartado na captura).
export async function appendEvento(ev, tx = prisma) {
  const portalClientId = ev?.portalClientId;
  const chaveAcesso = ev?.chaveAcesso;
  const tipoEvento = ev?.tipoEvento;
  if (!portalClientId || !chaveAcesso || !tipoEvento) {
    const e = new Error("portalClientId, chaveAcesso e tipoEvento são obrigatórios"); e.code = "INVALID_INPUT"; throw e;
  }
  const nSeqEvento = Number.isFinite(ev.nSeqEvento) ? ev.nSeqEvento : 1;
  const where = { chaveAcesso_tipoEvento_nSeqEvento: { chaveAcesso, tipoEvento, nSeqEvento } };
  const before = await tx.evento.findUnique({ where, select: { id: true } });
  const evento = await tx.evento.upsert({
    where,
    update: {}, // imutável
    create: {
      portalClientId,
      chaveAcesso,
      tipoEvento,
      nSeqEvento,
      dataEvento: ev.dataEvento ?? null,
      justificativa: ev.justificativa ?? null,
      chaveSubstituta: ev.chaveSubstituta ?? null,
      xmlEvento: ev.xmlEvento ?? null,
      nsuOrigem: toBigIntOrNull(ev.nsuOrigem),
      fonte: ev.fonte || "MANUAL",
    },
  });
  return { evento, created: !before };
}

// Avança o watermark do (portalClientId, fonte) — só pra frente. Chamar DENTRO da $transaction
// dos appends, e só APÓS persistência confirmada. Pular NSU não é seguro; reprocessar é (idempotente).
export async function avancarWatermark({ portalClientId, fonte, nsu, primeiroNsuDisponivel }, tx = prisma) {
  if (!portalClientId || !fonte) {
    const e = new Error("portalClientId e fonte são obrigatórios"); e.code = "INVALID_INPUT"; throw e;
  }
  const nsuBig = BigInt(nsu);
  const existing = await tx.nsuWatermark.findUnique({ where: { portalClientId_fonte: { portalClientId, fonte } } });
  const proximoNsu = existing && existing.ultimoNsuProcessado >= nsuBig ? existing.ultimoNsuProcessado : nsuBig;
  return tx.nsuWatermark.upsert({
    where: { portalClientId_fonte: { portalClientId, fonte } },
    create: {
      portalClientId, fonte,
      ultimoNsuProcessado: nsuBig,
      primeiroNsuDisponivel: toBigIntOrNull(primeiroNsuDisponivel),
    },
    update: {
      ultimoNsuProcessado: proximoNsu,
      ...(primeiroNsuDisponivel != null ? { primeiroNsuDisponivel: BigInt(primeiroNsuDisponivel) } : {}),
    },
  });
}
