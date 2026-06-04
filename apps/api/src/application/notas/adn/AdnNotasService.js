// Q12.B+ rework: captura de NFS-e via ADN Nacional do gov.br/nfse.
//
// Substitui o AdnSyncService legado (que dependia de ADN_BASE_URL/ADN_DFE_PATH —
// vars removidas em Q8.B dead-code cleanup). Agora usa endpoints públicos
// fixos do Padrão Nacional NFS-e e auth mTLS via cert do escritório (SERPRO).
//
// Reuso:
//   - AdnXmlMetadata.parseXmlMetadata() — parser do XML da NFS-e (continua válido)
//   - pfxToTls.extractTlsMaterialFromPfx — extração JS pura do PFX
//
// Estado: PortalSyncState.adnNsuCursor (separado do legado lastCursor).
// Persistência: direto em PortalInvoice + NotaItem (módulo Notas).

import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { fetchDfeNFSe, AdnNacionalClientError } from "../adn-nacional/AdnNacionalClient.js";
import { parseXmlMetadata } from "../../nfse/AdnXmlMetadata.js";
import { resolveCertForCompany, SERVICOS } from "../CertResolver.js";
import { resolveCertificatePath } from "../../../infrastructure/storage/CertStorage.js";
import { getResolvedSerproCredentials } from "../../fiscal/serpro/SerproRuntimeSettings.js";
import { ESTADOS } from "../CompetenciaStateMachine.js";

const MAX_ITERATIONS = 10;
const BACKOFF_MINUTES_ON_ERROR = 15;
// Q12.B+++.10: ADN tem rate limit por requisição (~1 req/s observado).
// Delay entre chamadas pra evitar HTTP 429 dentro do mesmo ciclo.
const DELAY_BETWEEN_REQUESTS_MS = 1100;
// HTTP 429 = backoff menor (15min) pra retomar logo (mesmo cursor preservado).
const BACKOFF_MINUTES_ON_429 = 15;

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
      password: creds.certificate.password,
    };
  }
  const certPath = resolveCertificatePath(creds.certificate.storageKey);
  if (!certPath || !fs.existsSync(certPath)) {
    throw new AdnNotasSyncError("OFFICE_CERT_FILE_NOT_FOUND", `Arquivo não encontrado: ${certPath}`);
  }
  return { pfxBuffer: fs.readFileSync(certPath), password: creds.certificate.password };
}

async function resolveCertWithFallback(portalClientId) {
  // Q12.B+++: ADN Contribuinte exige cert digital DO CNPJ que consulta.
  // O cert do escritório não tem cadastro no gov.br/nfse pra atuar em nome
  // das empresas — então A1 da empresa é PREFERIDO (oposto do DfeSyncService).
  const r = await resolveCertForCompany({ portalClientId, servico: SERVICOS.NFSE })
    .catch(() => ({ source: "none" }));
  if (r.source === "company_a1") {
    return { pfxBuffer: r.pfxBuffer, password: r.password, via: "company_a1" };
  }

  // Fallback (provavelmente vai dar 404 no ADN, mas mantém pra não bloquear
  // quem tem o escritório cadastrado lá).
  try {
    const office = await loadOfficeCert();
    return { pfxBuffer: office.pfxBuffer, password: office.password, via: "office_cert_fallback" };
  } catch {
    throw new AdnNotasSyncError("NO_COMPANY_CERT",
      "Esta empresa não tem certificado A1 cadastrado. Vá em Editar Cadastro → Certificado e faça upload do PFX da empresa.");
  }
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

async function setBackoff({ clientId, errorMsg, minutes }) {
  const mins = Number.isFinite(minutes) ? minutes : BACKOFF_MINUTES_ON_ERROR;
  const backoffUntil = new Date(Date.now() + mins * 60 * 1000);
  await prisma.portalSyncState.upsert({
    where: { clientId },
    create: { clientId, adnBackoffUntil: backoffUntil, adnLastError: errorMsg },
    update: { adnBackoffUntil: backoffUntil, adnLastError: errorMsg },
  }).catch(() => null);
}

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Captura NFS-e via ADN Nacional (gov.br/nfse) pra UMA empresa.
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {"prod"|"hom"} [opts.env="prod"]
 */
export async function syncAdnNotasForCompany({ portalClientId, env = "prod" }) {
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

      // Q12.B+++.10: delay entre chamadas pra evitar 429 (a partir da 2ª)
      if (iterations > 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, DELAY_BETWEEN_REQUESTS_MS));
      }

      const r = await fetchDfeNFSe({
        cnpj: companyCnpj,
        ultNSU: cursor.toString(),
        pfxBuffer: cert.pfxBuffer,
        password: cert.password,
        env,
        // Q12.B+++: na 1ª iteração com cursor=0, ativa autodescoberta (tenta NSU=0 e NSU=1)
        autoDiscover: cursor === 0n && iterations === 1,
      });
      const status = r.status;
      const items = r.items || [];

      if (status === "REJEICAO") {
        throw new AdnNotasSyncError("ADN_REJEICAO", `ADN rejeitou: ${JSON.stringify(r.errors || {})}`);
      }
      if (status === "NENHUM_DOCUMENTO_LOCALIZADO" || items.length === 0) {
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
    // Q12.B+++.10: backoff curto pra 429 (retoma em 15min do mesmo cursor)
    const minutes = code === "HTTP_429" ? BACKOFF_MINUTES_ON_429 : BACKOFF_MINUTES_ON_ERROR;
    await setBackoff({ clientId: portalClientId, errorMsg: `[${code}] ${msg}`.slice(0, 500), minutes });
    // Importante: cursor JÁ FOI persistido a cada iteração bem-sucedida.
    // Próximo ciclo retoma do mesmo ponto sem perder progresso.
    return { ok: false, reason: code, message: msg, iterations, totalDocs };
  }
}
