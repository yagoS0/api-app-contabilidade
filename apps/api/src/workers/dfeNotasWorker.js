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

import { log, DFE_NOTAS_WORKER_ENABLED, DFE_NOTAS_WORKER_INTERVAL_MIN, DFE_NOTAS_HEARTBEAT_DAYS } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { syncDfeForCompany } from "../application/notas/dfe/DfeSyncService.js";
import { syncAdnNotasForCompany } from "../application/notas/adn/AdnNotasService.js";
import { processPendingForCompany as processManifestacoes } from "../application/notas/dfe/NfeManifestacaoService.js";

const LOCK_ID = "dfe_notas_capture_lock";
const LOCK_TTL_MS = 30 * 60 * 1000; // 30 min
const LOOP_INTERVAL_MS = 60 * 1000; // 1 min de poll do worker
const MIN_INTERVAL_BETWEEN_SYNCS_MS = (DFE_NOTAS_WORKER_INTERVAL_MIN || 60) * 60 * 1000; // 1h default
// Q12.B+++.6: heartbeat — threshold pra considerar CNPJ "atrasado"
const HEARTBEAT_THRESHOLD_MS = (DFE_NOTAS_HEARTBEAT_DAYS || 7) * 24 * 60 * 60 * 1000;

function minutesSince(date) {
  if (!date) return Infinity;
  return Math.floor((Date.now() - new Date(date).getTime()) / 60000);
}

/**
 * TODAS as empresas ativas, cada uma com o veredito de elegibilidade — nunca uma lista já filtrada.
 *
 * ⚠ Aqui morava um `filter` que DESCARTAVA empresa sem A1 (ou com A1 vencido) sem deixar rastro. O
 * log dizia "N CNPJs elegíveis" e pronto: quem olhava não tinha como saber quantas nem chegaram a
 * ser tentadas. Foi assim que a captura ficou 29 dias parada em produção sem ninguém perceber.
 *
 * Agora quem decide o que fazer com a inelegível é o laço — e ele REGISTRA o motivo.
 */
async function listCompaniesComElegibilidade() {
  const portals = await prisma.portalClient.findMany({
    where: { cnpj: { not: "" }, status: { not: "SUSPENSA" } },
    select: { id: true, razao: true, cnpj: true, companyId: true },
  });
  if (!portals.length) return [];

  const companyIds = portals.map((p) => p.companyId).filter(Boolean);
  const companies = companyIds.length
    ? await prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, certStorageKey: true, certExpiresAt: true },
    })
    : [];
  const byId = new Map(companies.map((c) => [c.id, c]));

  return portals.map((p) => {
    const c = byId.get(p.companyId);
    if (!c?.certStorageKey) {
      return { portal: p, elegivel: false, motivo: "sem certificado A1 da empresa" };
    }
    if (c.certExpiresAt && new Date(c.certExpiresAt) < new Date()) {
      return {
        portal: p,
        elegivel: false,
        motivo: `certificado A1 vencido em ${new Date(c.certExpiresAt).toLocaleDateString("pt-BR")}`,
      };
    }
    return { portal: p, elegivel: true, motivo: null };
  });
}

export async function runDfeNotasWorkerOnce(options = {}) {
  const locked = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
  if (!locked) return { skipped: true, reason: "lock_active" };

  const startedAt = Date.now();
  const results = { dfe: [], adn: [], manifest: [] };
  const inelegiveis = [];
  try {
    const empresas = await listCompaniesComElegibilidade();
    const elegiveis = empresas.filter((e) => e.elegivel);
    log.info({ total: empresas.length, elegiveis: elegiveis.length }, "[dfeNotasWorker] CNPJs do ciclo");

    for (const { portal, elegivel, motivo } of empresas) {
      // Inelegível NÃO some mais em silêncio: entra no resumo com o motivo. Antes o `filter`
      // descartava antes do laço e o log só dizia "N elegíveis" — quem lia não tinha como saber
      // quantas nem chegaram a ser tentadas.
      if (!elegivel) {
        inelegiveis.push({ portalClientId: portal.id, razao: portal.razao, cnpj: portal.cnpj, motivo });
        log.warn({ portalClientId: portal.id, razao: portal.razao, motivo }, "[dfeNotasWorker] empresa NÃO tentada");
        continue;
      }
      // Lê estado atual
      // eslint-disable-next-line no-await-in-loop
      const state = await prisma.portalSyncState.findUnique({
        where: { clientId: portal.id },
      });

      const dfeSinceLast = minutesSince(state?.dfeLastSyncAt);
      const adnSinceLast = minutesSince(state?.adnLastSyncAt);
      const intervalMin = MIN_INTERVAL_BETWEEN_SYNCS_MS / 60000;
      const heartbeatMin = HEARTBEAT_THRESHOLD_MS / 60000;

      // Q12.B+++.6: heartbeat — CNPJ com >N dias sem sync (ou nunca sincronizado)
      // ignora o intervalo de 1h e força execução. Evita perder geração de NSU
      // por inatividade prolongada (regra dos 60 dias do AN).
      const dfeHeartbeatOverdue = dfeSinceLast >= heartbeatMin;
      const adnHeartbeatOverdue = adnSinceLast >= heartbeatMin;

      // DFe SEFAZ (NF-e)
      if (dfeSinceLast >= intervalMin || dfeHeartbeatOverdue) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await syncDfeForCompany({ portalClientId: portal.id, env: "prod" });
          results.dfe.push({
            portalClientId: portal.id, razao: portal.razao,
            ok: r.ok, totalDocs: r.totalDocs, reason: r.reason, message: r.message,
            heartbeat: dfeHeartbeatOverdue,
          });
          if (dfeHeartbeatOverdue) {
            log.warn({ portalClientId: portal.id, razao: portal.razao, daysSince: Math.floor(dfeSinceLast / (24 * 60)) },
              "[dfeNotasWorker] HEARTBEAT DFe executado — CNPJ estava atrasado");
          }
        } catch (err) {
          log.warn({ err: err?.message, portalClientId: portal.id }, "[dfeNotasWorker] erro DFe");
          results.dfe.push({ portalClientId: portal.id, ok: false, error: err?.message });
        }
      } else {
        results.dfe.push({ portalClientId: portal.id, skipped: true, reason: `wait_${intervalMin - dfeSinceLast}min` });
      }

      // ADN NFS-e (gov.br)
      if (adnSinceLast >= intervalMin || adnHeartbeatOverdue) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await syncAdnNotasForCompany({ portalClientId: portal.id, env: "prod" });
          results.adn.push({
            portalClientId: portal.id, razao: portal.razao,
            ok: r.ok, totalDocs: r.totalDocs, reason: r.reason, message: r.message,
            heartbeat: adnHeartbeatOverdue,
          });
          if (adnHeartbeatOverdue) {
            log.warn({ portalClientId: portal.id, razao: portal.razao, daysSince: Math.floor(adnSinceLast / (24 * 60)) },
              "[dfeNotasWorker] HEARTBEAT ADN executado — CNPJ estava atrasado");
          }
        } catch (err) {
          log.warn({ err: err?.message, portalClientId: portal.id }, "[dfeNotasWorker] erro ADN");
          results.adn.push({ portalClientId: portal.id, ok: false, error: err?.message });
        }
      } else {
        results.adn.push({ portalClientId: portal.id, skipped: true, reason: `wait_${intervalMin - adnSinceLast}min` });
      }

      // Q12.B+++.8.d: processa fila de manifestação dessa empresa
      // (lote máx 20 por chamada — SEFAZ limit). Sem rate limit próprio
      // porque já tá dentro do loop por CNPJ que tem o 1h do worker.
      try {
        // eslint-disable-next-line no-await-in-loop
        const m = await processManifestacoes({ portalClientId: portal.id, env: "prod" });
        if (m.processed > 0) {
          results.manifest.push({
            portalClientId: portal.id, razao: portal.razao,
            processed: m.processed, sent: m.sent, duplicates: m.duplicates, errors: m.errors,
            reason: m.reason,
          });
        }
      } catch (err) {
        log.warn({ err: err?.message, portalClientId: portal.id }, "[dfeNotasWorker] erro Manifest");
        results.manifest.push({ portalClientId: portal.id, ok: false, error: err?.message });
      }
    }

    // ─── REGISTRO DA VARREDURA ────────────────────────────────────────────────────────────────
    // Mesmas tabelas do lote manual da aba Consultas, para as duas origens aparecerem lado a lado.
    // Sem isto, "a rotina rodou hoje?" só se responde abrindo log de container — e foi por isso que
    // ela ficou 29 dias parada em produção sem ninguém notar.
    const dadosPorId = new Map(empresas.map(({ portal }) => [portal.id, portal]));
    const paraItem = (r, alvo) => {
      const portal = dadosPorId.get(r.portalClientId) || {};
      const base = { portalClientId: r.portalClientId, razao: portal.razao || null, cnpj: portal.cnpj || null, alvo };
      if (r.skipped) {
        const min = String(r.reason || "").match(/wait_(\d+)min/)?.[1];
        return { ...base, status: "aguardando", motivo: min ? `consultada há pouco — próxima em ${min} min` : r.reason || null };
      }
      if (r.ok === false || r.error) {
        if (r.reason === "backoff_active") return { ...base, status: "aguardando", motivo: "em espera após erro" };
        return { ...base, status: "erro", motivo: String(r.reason || r.error || r.message || "falha").slice(0, 200) };
      }
      const docs = Number(r.totalDocs || 0);
      return { ...base, status: docs > 0 ? "capturou" : "nada_novo", totalDocs: docs, novos: docs };
    };
    // As inelegíveis entram PRIMEIRO e uma vez por alvo: são justamente as que sumiam antes, e a
    // tela precisa mostrá-las junto das demais, não numa nota de rodapé.
    const itensDoRegistro = inelegiveis.flatMap((i) => ["NFSE", "NFE"].map((alvo) => ({
      portalClientId: i.portalClientId, razao: i.razao, cnpj: i.cnpj,
      alvo, status: "pulada", motivo: i.motivo,
    })));
    for (const r of results.dfe) itensDoRegistro.push(paraItem(r, "NFE"));
    for (const r of results.adn) itensDoRegistro.push(paraItem(r, "NFSE"));

    const totalNotas = itensDoRegistro.reduce((s, i) => s + Number(i.totalDocs || 0), 0);
    // Best-effort: falhar ao gravar o registro não pode invalidar uma varredura que JÁ capturou nota.
    await prisma.notasCapturaJob.create({
      data: {
        status: "concluido",
        origem: "automatico",
        alvos: ["NFSE", "NFE"],
        companyIds: empresas.map(({ portal }) => portal.id),
        totalEmpresas: empresas.length,
        processadas: empresas.length,
        totalNotas,
        itens: { createMany: { data: itensDoRegistro } },
      },
    }).catch((err) => log.warn({ err: err?.message }, "[dfeNotasWorker] falha ao registrar a varredura"));

    const dfeHeartbeats = results.dfe.filter((d) => d.heartbeat).length;
    const adnHeartbeats = results.adn.filter((a) => a.heartbeat).length;
    const manifestSent = results.manifest.reduce((s, r) => s + (r.sent || 0), 0);

    return {
      skipped: false,
      durationMs: Date.now() - startedAt,
      totalCnpjs: elegiveis.length,
      // Sai no retorno para o disparo manual mostrar quem ficou de fora, e por quê.
      naoTentadas: inelegiveis,
      heartbeats: { dfe: dfeHeartbeats, adn: adnHeartbeats },
      manifest: { totalSent: manifestSent, details: results.manifest },
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
            heartbeatsDfe: result.heartbeats?.dfe || 0,
            heartbeatsAdn: result.heartbeats?.adn || 0,
            manifestSent: result.manifest?.totalSent || 0,
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
