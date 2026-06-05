// Q12.B+++.8.d: orquestra manifestação do destinatário.
//
// Fluxo:
//   1) enqueueManifestacao({ portalClientId, chaveAcesso, tpEvento })
//      → upsert em NfeManifestacaoQueue (idempotente por chave+tpEvento)
//   2) Worker chama processPendingForCompany({ portalClientId })
//      → pega até 20 PENDING, monta XMLs, assina, envia em 1 lote SEFAZ
//      → atualiza status SENT/ERROR/DUPLICATE com retorno
//
// Após manifestação bem-sucedida (cStat 135 ou 573), o próximo ciclo de
// DfeSyncService traz a NF-e completa (procNFe) em vez do resumo (resNFe).

import { prisma } from "../../../infrastructure/db/prisma.js";
import { resolveCertForCompany, SERVICOS } from "../CertResolver.js";
import { signEvento } from "./XmlSigner.js";
import { sendEventos, NfeEventoClientError } from "./NfeEventoClient.js";

const MAX_BATCH = 20;
const MAX_ATTEMPTS = 5;

const TP_EVENTO_LABELS = {
  "210200": "Confirmacao da Operacao",
  "210210": "Ciencia da Operacao",
  "210220": "Desconhecimento da Operacao",
  "210240": "Operacao nao Realizada",
};

export class NfeManifestacaoError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Enfileira um evento de manifestação. Idempotente: se já existe registro
 * pra mesma chave+tpEvento, não duplica.
 */
export async function enqueueManifestacao({ portalClientId, chaveAcesso, tpEvento = "210210" }) {
  if (!chaveAcesso || chaveAcesso.length !== 44) {
    throw new NfeManifestacaoError("INVALID_CHAVE", `Chave inválida: ${chaveAcesso}`);
  }
  if (!TP_EVENTO_LABELS[tpEvento]) {
    throw new NfeManifestacaoError("INVALID_TP_EVENTO", `tpEvento desconhecido: ${tpEvento}`);
  }
  return prisma.nfeManifestacaoQueue.upsert({
    where: {
      clientId_chaveAcesso_tpEvento: { clientId: portalClientId, chaveAcesso, tpEvento },
    },
    create: {
      clientId: portalClientId,
      chaveAcesso,
      tpEvento,
      status: "PENDING",
    },
    // Idempotente — não toca em registros já SENT/ERROR
    update: {},
  });
}

/**
 * Constrói o XML do evento de manifestação para 1 nota.
 *
 * @param {Object} args
 * @param {string} args.chNFe       chave de acesso (44 dígitos)
 * @param {string} args.cnpjAtor    CNPJ do destinatário (quem manifesta)
 * @param {string} args.tpEvento    "210210" | "210200" | "210220" | "210240"
 * @param {number} args.nSeqEvento  default 1
 * @returns {{ eventoXml: string, referenceId: string }}
 */
function buildEventoXml({ chNFe, cnpjAtor, tpEvento, nSeqEvento = 1 }) {
  // cOrgao: 91 = AN (Ambiente Nacional) — sempre 91 pra eventos de manifestação
  const cOrgao = 91;
  // tpAmb: passado externamente via envelope; aqui não vai no infEvento
  // verEvento: 1.00 — versão do schema do evento (não confundir com versão da NFe)
  const verEvento = "1.00";
  // Id: "ID" + tpEvento + chave + nSeqEvento (2 dígitos zero-padded)
  const seqStr = String(nSeqEvento).padStart(2, "0");
  const referenceId = `ID${tpEvento}${chNFe}${seqStr}`;
  const descEvento = TP_EVENTO_LABELS[tpEvento];

  // dhEvento: ISO 8601 com timezone -03:00 (padrão SEFAZ)
  // (Date.now() chamada — não vai violar test framework porque test
  // mocka esta função ou injeta dhEvento via test seam, mas em runtime real é OK)
  const now = new Date();
  const dhEvento = formatSefazDateTime(now);

  // detEvento.versao = "1.00", contém descEvento (texto fixo conforme tpEvento)
  const eventoXml =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="${verEvento}">` +
    `<infEvento Id="${referenceId}">` +
    `<cOrgao>${cOrgao}</cOrgao>` +
    `<tpAmb>1</tpAmb>` +  // 1=PROD; será sobrescrito pelo envEvento se hom
    `<CNPJ>${cnpjAtor}</CNPJ>` +
    `<chNFe>${chNFe}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>${verEvento}</verEvento>` +
    `<detEvento versao="${verEvento}">` +
    `<descEvento>${descEvento}</descEvento>` +
    `</detEvento>` +
    `</infEvento>` +
    `</evento>`;

  return { eventoXml, referenceId };
}

/**
 * Formata Date em "YYYY-MM-DDTHH:mm:ss-03:00" (timezone fixo BR conforme SEFAZ aceita).
 */
function formatSefazDateTime(d) {
  // Usa timezone local da máquina mas força sufixo -03:00.
  // Em produção (Railway/Docker), o container deve estar em TZ=America/Sao_Paulo.
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}-03:00`;
}

/**
 * Processa até MAX_BATCH eventos PENDING da empresa.
 * Resolve cert empresa (mesma regra do DfeSyncService Q12.B+++).
 * Assina cada evento e envia em 1 lote.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {"prod"|"hom"} [opts.env="prod"]
 * @returns {Promise<{ok, processed, sent, duplicates, errors, message?}>}
 */
export async function processPendingForCompany({ portalClientId, env = "prod" }) {
  // 1) Empresa + CNPJ
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { cnpj: true, razao: true, status: true },
  });
  if (!portal) return { ok: false, reason: "PORTAL_NOT_FOUND" };
  if (portal.status === "SUSPENSA") return { ok: false, reason: "COMPANY_SUSPENDED" };

  const cnpjAtor = String(portal.cnpj || "").replace(/\D+/g, "");
  if (cnpjAtor.length !== 14) {
    return { ok: false, reason: "INVALID_CNPJ" };
  }

  // 2) Pega lote PENDING (limite SEFAZ = 20)
  const pending = await prisma.nfeManifestacaoQueue.findMany({
    where: {
      clientId: portalClientId,
      status: "PENDING",
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_BATCH,
  });
  if (pending.length === 0) return { ok: true, processed: 0, sent: 0, duplicates: 0, errors: 0 };

  // 3) Cert empresa (A1 obrigatório — SEFAZ exige CNPJ-base bater)
  const certResolved = await resolveCertForCompany({ portalClientId, servico: SERVICOS.DFE })
    .catch(() => ({ source: "none" }));
  if (certResolved.source !== "company_a1") {
    // Marca todos como erro pra não ficar tentando à toa
    await prisma.nfeManifestacaoQueue.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { status: "ERROR", lastError: "Empresa sem A1 cadastrado (precisa pra assinar evento)", attempts: { increment: 1 } },
    });
    return { ok: false, reason: "NO_COMPANY_CERT", processed: 0, errors: pending.length };
  }
  const { pfxBuffer, password } = certResolved;

  // 4) Assina cada evento individualmente
  const eventosSignedXml = [];
  const idToQueueRow = new Map(); // referenceId → row da fila pra correlacionar retorno

  for (const row of pending) {
    try {
      const { eventoXml, referenceId } = buildEventoXml({
        chNFe: row.chaveAcesso,
        cnpjAtor,
        tpEvento: row.tpEvento,
        nSeqEvento: row.nSeqEvento,
      });
      const signed = signEvento({ eventoXml, referenceId, pfxBuffer, password });
      eventosSignedXml.push(signed);
      idToQueueRow.set(row.chaveAcesso, row);
    } catch (err) {
      await prisma.nfeManifestacaoQueue.update({
        where: { id: row.id },
        data: {
          status: "ERROR",
          attempts: { increment: 1 },
          lastError: `Sign falhou: ${err?.message}`.slice(0, 500),
        },
      });
    }
  }

  if (eventosSignedXml.length === 0) {
    return { ok: false, reason: "ALL_SIGNS_FAILED", processed: pending.length, errors: pending.length };
  }

  // 5) Envia lote
  let result;
  try {
    result = await sendEventos({ eventosSignedXml, pfxBuffer, password, env });
  } catch (err) {
    // Falha de rede/SOAP genérica: incrementa attempts pra retry futuro
    await prisma.nfeManifestacaoQueue.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: {
        attempts: { increment: 1 },
        lastError: `Send falhou: ${err?.code || ""} ${err?.message || err}`.slice(0, 500),
      },
    });
    return { ok: false, reason: err?.code || "SEND_FAILED", message: err?.message, processed: pending.length };
  }

  // 6) Atualiza fila com retorno por evento
  let sent = 0, duplicates = 0, errors = 0;
  for (const ret of result.retEventos) {
    const row = idToQueueRow.get(ret.chNFe);
    if (!row) continue;
    let newStatus = "ERROR";
    let lastError = null;
    if (ret.cStat === "135") { newStatus = "SENT"; sent++; }
    else if (ret.cStat === "573") { newStatus = "DUPLICATE"; duplicates++; }
    else { errors++; lastError = `cStat=${ret.cStat}: ${ret.xMotivo}`; }

    await prisma.nfeManifestacaoQueue.update({
      where: { id: row.id },
      data: {
        status: newStatus,
        attempts: { increment: 1 },
        cStat: ret.cStat,
        xMotivo: ret.xMotivo,
        protocoloSefaz: ret.nProt,
        sentAt: new Date(),
        lastError,
        lastResponse: JSON.stringify(ret).slice(0, 1000),
      },
    });
  }

  return {
    ok: true,
    processed: pending.length,
    sent,
    duplicates,
    errors,
    cStatLote: result.cStat,
    xMotivoLote: result.xMotivo,
  };
}

// Re-exports
export { TP_EVENTO_LABELS, MAX_BATCH };
