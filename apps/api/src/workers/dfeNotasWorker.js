// Q12.B+++.5: worker automático de captura DFe (NF-e SEFAZ + NFS-e ADN).
//
// REGRAS DO MERCADO FISCAL (NT 2014.002 v1.10):
// - Cada CNPJ pode ter UM único agente consultando NFeDistribuicaoDFe.
// - Intervalo mínimo recomendado entre ciclos: 1 hora (senão risco de
//   "Rejeição: Consumo Indevido" com bloqueio de 1h).
// - CNPJ inativo por 60+ dias perde geração de NSU no AN. Este worker
//   garante atividade contínua pra TODOS os CNPJs ativos do sistema.
//
// Loop:
//   1) Lock global (1 instância). Cada CNPJ tem seu próprio sub-lock implícito
//      via PortalSyncState.dfeLastSyncAt + intervalo mínimo.
//   2) Lista CNPJs ATIVOS (não SUSPENSA) com A1 cadastrado.
//   3) Pra cada um, verifica: passou 1h desde último sync (DFe e/ou ADN)?
//      Se sim, roda 1 ciclo de captura.
//   4) Erro = isolado (não bloqueia outros CNPJs).
//
// Ativação opcional via env: DFE_NOTAS_WORKER_ENABLED=1

import { log, DFE_NOTAS_WORKER_ENABLED, DFE_NOTAS_WORKER_INTERVAL_MIN } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { syncDfeForCompany } from "../application/notas/dfe/DfeSyncService.js";
import { syncAdnNotasForCompany } from "../application/notas/adn/AdnNotasService.js";

const LOCK_ID = "dfe_notas_capture_lock";
const LOCK_TTL_MS = 30 * 60 * 1000; // 30 min
const LOOP_INTERVAL_MS = 60 * 1000; // 1 min de poll do worker
const MIN_INTERVAL_BETWEEN_SYNCS_MS = (DFE_NOTAS_WORKER_INTERVAL_MIN || 60) * 60 * 1000; // 1h default

function minutesSince(date) {
  if (!date) return Infinity;
  return Math.floor((Date.now() - new Date(date).getTime()) / 60000);
}

async function listEligibleCompanies() {
  // CNPJs ativos com A1 cadastrado na Company legacy
  const portals = await prisma.portalClient.findMany({
    where: { cnpj: { not: "" }, status: { not: "SUSPENSA" } },
    select: { id: true, razao: true, cnpj: true, companyId: true },
  });
  const companyIds = portals.map((p) => p.companyId).filter(Boolean);
  if (companyIds.length === 0) return [];

  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, certStorageKey: true, certExpiresAt: true },
  });
  const byId = new Map(companies.map((c) => [c.id, c]));

  return portals.filter((p) => {
    const c = byId.get(p.companyId);
    if (!c?.certStorageKey) return false;
    // ignora certs expirados
    if (c.certExpiresAt && new Date(c.certExpiresAt) < new Date()) return false;
    return true;
  });
}

export async function runDfeNotasWorkerOnce(options = {}) {
  const locked = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
  if (!locked) return { skipped: true, reason: "lock_active" };

  const startedAt = Date.now();
  const results = { dfe: [], adn: [] };
  try {
    const portals = await listEligibleCompanies();
    log.info({ count: portals.length }, "[dfeNotasWorker] CNPJs elegíveis");

    for (const portal of portals) {
      // Lê estado atual
      // eslint-disable-next-line no-await-in-loop
      const state = await prisma.portalSyncState.findUnique({
        where: { clientId: portal.id },
      });

      const dfeSinceLast = minutesSince(state?.dfeLastSyncAt);
      const adnSinceLast = minutesSince(state?.adnLastSyncAt);
      const intervalMin = MIN_INTERVAL_BETWEEN_SYNCS_MS / 60000;

      // DFe SEFAZ (NF-e)
      if (dfeSinceLast >= intervalMin) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await syncDfeForCompany({ portalClientId: portal.id, env: "prod" });
          results.dfe.push({ portalClientId: portal.id, razao: portal.razao, ok: r.ok, totalDocs: r.totalDocs, reason: r.reason });
        } catch (err) {
          log.warn({ err: err?.message, portalClientId: portal.id }, "[dfeNotasWorker] erro DFe");
          results.dfe.push({ portalClientId: portal.id, ok: false, error: err?.message });
        }
      } else {
        results.dfe.push({ portalClientId: portal.id, skipped: true, reason: `wait_${intervalMin - dfeSinceLast}min` });
      }

      // ADN NFS-e (gov.br) — só roda se passou o intervalo
      if (adnSinceLast >= intervalMin) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await syncAdnNotasForCompany({ portalClientId: portal.id, env: "prod" });
          results.adn.push({ portalClientId: portal.id, razao: portal.razao, ok: r.ok, totalDocs: r.totalDocs, reason: r.reason });
        } catch (err) {
          log.warn({ err: err?.message, portalClientId: portal.id }, "[dfeNotasWorker] erro ADN");
          results.adn.push({ portalClientId: portal.id, ok: false, error: err?.message });
        }
      } else {
        results.adn.push({ portalClientId: portal.id, skipped: true, reason: `wait_${intervalMin - adnSinceLast}min` });
      }
    }

    return {
      skipped: false,
      durationMs: Date.now() - startedAt,
      totalCnpjs: portals.length,
      dfe: results.dfe,
      adn: results.adn,
    };
  } finally {
    await releaseGuideLock(LOCK_ID);
  }
}

export async function runDfeNotasWorkerLoop() {
  log.info({
    enabled: DFE_NOTAS_WORKER_ENABLED,
    intervalMin: MIN_INTERVAL_BETWEEN_SYNCS_MS / 60000,
  }, "[dfeNotasWorker] loop iniciado");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (DFE_NOTAS_WORKER_ENABLED) {
        const result = await runDfeNotasWorkerOnce();
        if (!result.skipped) {
          log.info({
            totalCnpjs: result.totalCnpjs,
            dfeOk: result.dfe?.filter((d) => d.ok).length,
            adnOk: result.adn?.filter((a) => a.ok).length,
            durationMs: result.durationMs,
          }, "[dfeNotasWorker] ciclo concluído");
        }
      }
    } catch (err) {
      log.error({ err: err?.message || err }, "[dfeNotasWorker] erro no ciclo");
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, LOOP_INTERVAL_MS));
  }
}

if (process.argv[1] && process.argv[1].endsWith("dfeNotasWorker.js")) {
  const isOnce = process.argv.includes("--once");
  if (isOnce) {
    runDfeNotasWorkerOnce()
      .then((result) => {
        log.info({ result }, "[dfeNotasWorker] --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "[dfeNotasWorker] --once falhou");
        process.exit(1);
      });
  } else {
    runDfeNotasWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "[dfeNotasWorker] loop fatal");
      process.exit(1);
    });
  }
}
