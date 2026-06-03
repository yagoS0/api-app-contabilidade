// Q12.B+: captura de NFS-e via ADN (Emissor Nacional / RN-141) para o módulo Notas.
//
// **Reuso deliberado** (não duplica infra):
//   - AdnSyncService.fetchLote() — cliente HTTP com mTLS via PFX (config ADN_*)
//   - AdnXmlMetadata.parseXmlMetadata() — parser do XML da NFS-e
//   - CertResolver — decide procuração escritório vs A1 empresa
//   - SerproRuntimeSettings (via DfeSyncService.loadOfficeCert? Não — reuso direto)
//
// **NÃO usa** o cursor lastCursor nem a tabela AdnDocument do AdnSyncService legado.
// Usa adnNsuCursor (novo, Q12.B+ migration) e grava direto em PortalInvoice + NotaItem.
//
// Fluxo:
//   1) Backoff check
//   2) Cert (procuração escritório → SERPRO; senão A1 empresa)
//   3) Loop fetchLote → parseLoteResponse → parseXmlMetadata → upsert PortalInvoice
//   4) Cursor adnNsuCursor atualizado atomicamente com persistência

import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { AdnSyncService } from "../../nfse/AdnSyncService.js";
import { parseXmlMetadata } from "../../nfse/AdnXmlMetadata.js";
import { resolveCertForCompany, SERVICOS } from "../CertResolver.js";
import { resolveCertificatePath } from "../../../infrastructure/storage/CertStorage.js";
import { getResolvedSerproCredentials } from "../../fiscal/serpro/SerproRuntimeSettings.js";
import { ESTADOS } from "../CompetenciaStateMachine.js";

const MAX_ITERATIONS = 10;
const BACKOFF_MINUTES_ON_ERROR = 15;

export class AdnNotasSyncError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// ─── Resolução de cert (mesmo padrão do DfeSyncService) ─────────────────────

async function loadOfficeCert() {
  const creds = await getResolvedSerproCredentials().catch((err) => {
    throw new AdnNotasSyncError("OFFICE_CERT_NOT_CONFIGURED",
      `Cert do escritório não configurado em Configurações da Firma → SERPRO. (${err?.message})`);
  });
  if (!creds?.certificate?.hasCertificate) {
    throw new AdnNotasSyncError("OFFICE_CERT_NOT_CONFIGURED", "Cert do escritório não está configurado.");
  }
  if (!creds.certificate.passwordConfigured) {
    throw new AdnNotasSyncError("OFFICE_CERT_PASSWORD_MISSING", "Senha do cert do escritório não está configurada.");
  }
  if (creds.certificate.pfxBase64) {
    return {
      pfxBuffer: Buffer.from(creds.certificate.pfxBase64, "base64"),
      pfxPassword: creds.certificate.password,
    };
  }
  const certPath = resolveCertificatePath(creds.certificate.storageKey);
  if (!certPath || !fs.existsSync(certPath)) {
    throw new AdnNotasSyncError("OFFICE_CERT_FILE_NOT_FOUND", `Arquivo não encontrado: ${certPath}`);
  }
  return { pfxBuffer: fs.readFileSync(certPath), pfxPassword: creds.certificate.password };
}

async function resolveCertWithFallback(portalClientId) {
  const r = await resolveCertForCompany({ portalClientId, servico: SERVICOS.NFSE })
    .catch((err) => ({ source: "none", error: err }));

  if (r.source === "procuracao_escritorio") {
    const office = await loadOfficeCert();
    return { certInfo: office, via: "office_cert_via_procuracao" };
  }
  if (r.source === "company_a1") {
    return { certInfo: { pfxBuffer: r.pfxBuffer, pfxPassword: r.password }, via: "company_a1" };
  }
  throw new AdnNotasSyncError("NO_CERT",
    r.error?.message || "Sem cert: cadastre procuração e-CAC NFSE OU faça upload do A1.");
}

// ─── Decodificação do XML ──────────────────────────────────────────────────

function decodeXml(arquivoXml) {
  // AdnSyncService já tem essa função interna; replicamos pra não exportar tudo.
  // Tenta gunzip primeiro (base64+gzip), cai pra base64 puro se falhar.
  const raw = Buffer.from(arquivoXml, "base64");
  try {
    return gunzipSync(raw).toString("utf-8");
  } catch {
    return raw.toString("utf-8");
  }
}

// ─── Competência fechada → vira pendência (mesmo padrão Dfe) ───────────────

async function isCompetenciaFechada(tx, { portalClientId, competenciaDate }) {
  if (!competenciaDate) return false;
  const d = new Date(competenciaDate);
  const comp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const row = await tx.companyMonthlyCircular.findFirst({
    where: { portalClientId, competencia: comp },
    select: { estado: true },
  });
  return row && [ESTADOS.FECHADO, ESTADOS.CALCULADO, ESTADOS.REVISADO, ESTADOS.TRANSMITIDO, ESTADOS.CONFIRMADO].includes(row.estado);
}

// ─── Persistência: NFS-e → PortalInvoice ───────────────────────────────────

async function upsertNfseFromItem(tx, { portalClientId, companyCnpj, item, xmlPlain, metadata }) {
  const chaveAcesso = item.ChaveAcesso || item.chaveAcesso || null;
  if (!chaveAcesso) return { skipped: true, reason: "no_chave" };

  // Papel: EMIT se prestador é a empresa; senão DEST. NFS-e quase sempre EMIT
  // (a empresa só recebe DFe de NFS-e em casos específicos).
  const cnpjPrestador = metadata.cnpjPrestador || "";
  const papel = cnpjPrestador && cnpjPrestador === String(companyCnpj || "").replace(/\D+/g, "") ? "EMIT" : "DEST";

  const competenciaDate = metadata.competencia || metadata.dataEmissao || null;
  const fechada = await isCompetenciaFechada(tx, { portalClientId, competenciaDate });

  const dataToWrite = {
    type: "NFSE",
    numero: metadata.numeroNfse,
    chaveAcesso,
    competencia: competenciaDate,
    issueDate: metadata.dataEmissao,
    total: metadata.valorServicos,
    emitenteNome: metadata.prestadorNome,
    emitenteDoc: metadata.cnpjPrestador,
    tomadorNome: metadata.tomadorNome,
    tomadorDoc: metadata.cnpjTomador,
    xmlRaw: xmlPlain || null,
    status: metadata.situacao === "CANCELADA" || metadata.situacao === "2" ? "CANCELADA" : "EMITIDA",
    papel,
    statusEfetivo: metadata.situacao === "CANCELADA" || metadata.situacao === "2" ? "cancelada" : "autorizada",
    competenciaPosFechamento: fechada || false,
  };

  if (fechada) {
    const created = await tx.portalInvoice.upsert({
      where: { clientId_chaveAcesso: { clientId: portalClientId, chaveAcesso } },
      create: { clientId: portalClientId, ...dataToWrite },
      update: { competenciaPosFechamento: true, statusEfetivo: dataToWrite.statusEfetivo },
    });
    const comp = competenciaDate
      ? `${new Date(competenciaDate).getUTCFullYear()}-${String(new Date(competenciaDate).getUTCMonth() + 1).padStart(2, "0")}`
      : "?";
    await tx.pendenciaPosFechamento.create({
      data: {
        portalClientId, competencia: comp, notaId: created.id,
        motivo: "nota_retroativa",
        observacoes: `NFS-e ${chaveAcesso} chegou para ${comp} (competência já fechada).`,
      },
    }).catch(() => null);
    return { created: created.id, status: "pendencia_criada" };
  }

  await tx.portalInvoice.upsert({
    where: { clientId_chaveAcesso: { clientId: portalClientId, chaveAcesso } },
    create: { clientId: portalClientId, ...dataToWrite },
    update: dataToWrite,
  });
  return { status: "upserted" };
}

// ─── Cursor + backoff ──────────────────────────────────────────────────────

async function persistCursor(tx, { clientId, newCursor }) {
  await tx.portalSyncState.upsert({
    where: { clientId },
    create: { clientId, adnNsuCursor: newCursor, adnLastSyncAt: new Date(), adnLastError: null },
    update: { adnNsuCursor: newCursor, adnLastSyncAt: new Date(), adnLastError: null },
  });
}

async function setBackoff({ clientId, errorMsg }) {
  const backoffUntil = new Date(Date.now() + BACKOFF_MINUTES_ON_ERROR * 60 * 1000);
  await prisma.portalSyncState.upsert({
    where: { clientId },
    create: { clientId, adnBackoffUntil: backoffUntil, adnLastError: errorMsg },
    update: { adnBackoffUntil: backoffUntil, adnLastError: errorMsg },
  }).catch(() => null);
}

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Captura NFS-e via ADN pra UMA empresa.
 * @param {Object} opts
 * @param {string} opts.portalClientId
 */
export async function syncAdnNotasForCompany({ portalClientId }) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { id: true, razao: true, cnpj: true, status: true },
  });
  if (!portal) throw new AdnNotasSyncError("PORTAL_CLIENT_NOT_FOUND", "Empresa não encontrada");
  if (portal.status === "SUSPENSA") throw new AdnNotasSyncError("COMPANY_SUSPENDED", "Empresa suspensa");

  const state = await prisma.portalSyncState.findUnique({ where: { clientId: portalClientId } });
  if (state?.adnBackoffUntil && new Date(state.adnBackoffUntil) > new Date()) {
    return { ok: false, reason: "backoff_active", backoffUntil: state.adnBackoffUntil };
  }

  let cert;
  try {
    cert = await resolveCertWithFallback(portalClientId);
  } catch (err) {
    return { ok: false, reason: err.code || "cert_error", message: err.message };
  }

  const companyCnpj = String(portal.cnpj || "").replace(/\D+/g, "");
  let cursor = BigInt(state?.adnNsuCursor ?? 0);
  const byStatus = { upserted: 0, pendencia_criada: 0, skipped: 0 };
  let totalDocs = 0;
  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await AdnSyncService.fetchLote({
        nsu: cursor.toString(),
        cnpjConsulta: companyCnpj,
        lote: true,
        certInfo: cert.certInfo,
      });

      const status = response?.StatusProcessamento || response?.statusProcessamento || response?.status;
      const items = Array.isArray(response?.LoteDFe || response?.loteDFe || response?.documentos || response?.itens)
        ? (response.LoteDFe || response.loteDFe || response.documentos || response.itens)
        : (response?.LoteDFe || response?.loteDFe || response?.documentos || response?.itens ? [response.LoteDFe || response.loteDFe || response.documentos || response.itens] : []);

      if (String(status || "").toUpperCase() === "REJEICAO") {
        throw new AdnNotasSyncError("ADN_REJEICAO", `ADN rejeitou: ${JSON.stringify(response?.Erros || response?.erros || {})}`);
      }
      if (String(status || "").toUpperCase() === "NENHUM_DOCUMENTO_LOCALIZADO" || items.length === 0) {
        break;
      }

      let maxNsuThisIter = cursor;
      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          totalDocs++;
          const nsuRaw = item.NSU || item.nsu;
          if (nsuRaw) {
            const n = BigInt(nsuRaw);
            if (n > maxNsuThisIter) maxNsuThisIter = n;
          }
          const arquivoXml = item.ArquivoXml || item.arquivoXml;
          if (!arquivoXml) { byStatus.skipped++; continue; }

          const xmlPlain = decodeXml(arquivoXml);
          const metadata = parseXmlMetadata(xmlPlain);
          const r = await upsertNfseFromItem(tx, { portalClientId, companyCnpj, item, xmlPlain, metadata });
          byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        }
        // Cursor avança +1 (próximo NSU a buscar — convenção do ADN)
        const newCursor = maxNsuThisIter + 1n;
        await persistCursor(tx, { clientId: portalClientId, newCursor });
      });
      cursor = maxNsuThisIter + 1n;
    }

    return {
      ok: true, cnpj: companyCnpj, certVia: cert.via,
      iterations, totalDocs, byStatus,
      newCursor: cursor.toString(),
    };
  } catch (err) {
    const code = err?.code || "ADN_SYNC_FAILED";
    const msg = err?.message || String(err);
    await setBackoff({ clientId: portalClientId, errorMsg: `[${code}] ${msg}`.slice(0, 500) });
    return { ok: false, reason: code, message: msg, iterations, totalDocs };
  }
}
