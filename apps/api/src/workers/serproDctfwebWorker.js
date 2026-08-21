import { log } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { getReferenceCompetencia } from "../application/guides/guideCompliance.js";
import { resolveCompanyNotificationEmail } from "../application/guides/GuideScheduledEmailService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { SerproProcurationService } from "../application/fiscal/serpro/SerproProcurationService.js";
import { syncSerproInssForCompany } from "../application/fiscal/serpro/SerproDctfwebService.js";
import { createSerproExecutionLog } from "../application/fiscal/serpro/SerproExecutionLogService.js";
import { idsComRotinaAtiva } from "../application/fiscal/serpro/CompanyRotinasService.js";
import { matchesCron } from "./cronMatch.js";

const LOCK_ID = "serpro_dctfweb_capture_lock";
const LOCK_TTL_MS = 30 * 60 * 1000;
const LOOP_INTERVAL_MS = 60 * 1000;


async function listEligiblePortalCompanies() {
  // INSS via DCTFWeb se aplica a qualquer empresa com CNPJ válido e procuração SERPRO ativa.
  // syncSerproInssForCompany trata "não transmitida" graciosamente.
  // `cnpj` é String não-nulo no schema; filtramos só strings vazias por segurança.
  const companies = await prisma.portalClient.findMany({
    where: {
      cnpj: { not: "" },
      // Q11.1: empresas SUSPENSAS são puladas pelo worker DCTFWeb.
      status: { not: "SUSPENSA" },
    },
    select: {
      id: true,
      razao: true,
      cnpj: true,
      guideNotificationEmail: true,
    },
    orderBy: { razao: "asc" },
  });

  const eligible = [];
  for (const company of companies) {
    // eslint-disable-next-line no-await-in-loop
    const email = await resolveCompanyNotificationEmail(company.id);
    if (!email) continue;
    eligible.push({
      id: company.id,
      razao: company.razao,
      cnpj: company.cnpj,
      email,
    });
  }
  return eligible;
}

export async function runSerproDctfwebWorkerOnce(options = {}) {
  const locked = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
  if (!locked) return { skipped: true, reason: "lock_active" };

  try {
    const settings = await getSerproRuntimeSettings();
    if (!settings.enabled) {
      return { skipped: true, reason: "serpro_disabled" };
    }

    const competencia = options.competencia || getReferenceCompetencia();
    const companies = await listEligiblePortalCompanies();
    const procurationService = new SerproProcurationService();
    const results = [];
    const startedAt = Date.now();

    const now = new Date();
    const fetchDay = settings.fetchDay ?? 5;
    const isCaptureWindow = now.getDate() >= fetchDay;

    // Rotina `inss`: antes este worker tentava INSS em TODA empresa (não filtrava regime).
    // O seed marcou `inss` em todas justamente pra preservar isso — agora o contador vê
    // na tela e pode desmarcar quem não precisa.
    const cfgInss = settings.rotinas?.inss;
    const idsInss = await idsComRotinaAtiva("inss");
    const janelaInss = cfgInss
      ? (cfgInss.enabled !== false && now.getDate() >= (cfgInss.day ?? fetchDay))
      : isCaptureWindow;

    for (const company of companies) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const procuration = await procurationService.checkCompanyProcuration({ portalClientId: company.id });
        if (procuration.status !== "ATIVA") {
          results.push({
            companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
            competencia,
            status: "skipped_procuration_inactive",
            procurationStatus: procuration.status,
          });
          continue;
        }

        // Stage 1 — Captura inicial
        // eslint-disable-next-line no-await-in-loop
        const existingForCompetencia = await prisma.guide.findFirst({
          where: {
            portalClientId: company.id,
            source: "SERPRO",
            tipo: "INSS",
            competencia,
            status: "PROCESSED",
          },
          select: { id: true },
        });

        if (janelaInss && idsInss.has(company.id) && !existingForCompetencia) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const sync = await syncSerproInssForCompany({ portalClientId: company.id, competencia });
            // `NOT_INSS`: o DARF que o GERARGUIA31 devolveu é de PIS/COFINS/IRPJ/CSLL (empresa de
            // Lucro Presumido) — nada foi gravado. Fica com nome PRÓPRIO no log: cair no balde
            // "captured" foi exatamente como isso passou meses sem ninguém ver.
            const statusDaGuia = sync.inss?.status === "NOT_TRANSMITTED"
              ? "not_transmitted"
              : sync.inss?.status === "NOT_INSS" ? "nao_e_previdenciario" : "captured";
            results.push({
              companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
              competencia,
              status: statusDaGuia,
              guideId: sync.guide?.guideId || null,
              inssTotal: sync.inss?.inssTotal || null,
              inssVencimento: sync.inss?.inssVencimento || null,
              tributosDoDocumento: sync.inss?.tributosDoDocumento || null,
            });
          } catch (err) {
            results.push({
              companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
              competencia,
              status: "error",
              error: err?.code || "SERPRO_DCTFWEB_CAPTURE_FAILED",
              reason: err?.message || "serpro_dctfweb_capture_failed",
              retryable: Boolean(err?.retryable),
            });
          }
        }

        // Q53: Stage 2 (re-fetch diário das INSS OPEN passadas) REMOVIDO. Re-buscar guias de
        // competências já vencidas trazia o valor do SERPRO COM juros/multa e sobrescrevia a guia,
        // mesmo já paga no prazo → confusão contábil. Agora competências passadas só são recalculadas
        // sob pedido explícito (botão "Recalcular INSS" na aba Guias → /serpro/inss/sync).
      } catch (err) {
        results.push({
          companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
          competencia,
          status: "error",
          error: err?.code || "SERPRO_DCTFWEB_CYCLE_FAILED",
          reason: err?.message || "serpro_dctfweb_cycle_failed",
        });
      }
    }

    const summary = {
      skipped: false,
      competencia,
      fetchDay,
      isCaptureWindow,
      totalCompanies: companies.length,
      captured: results.filter((item) => item.status === "captured").length,
      notTransmitted: results.filter((item) => item.status === "not_transmitted").length,
      naoPrevidenciario: results.filter((item) => item.status === "nao_e_previdenciario").length,
      failed: results.filter((item) => item.status === "error").length,
      skippedByProcuration: results.filter((item) => item.status === "skipped_procuration_inactive").length,
      durationMs: Date.now() - startedAt,
      results,
    };
    await createSerproExecutionLog({
      worker: "serpro_dctfweb",
      createdAt: new Date().toISOString(),
      competencia,
      settings: {
        enabled: settings.enabled,
        environment: settings.environment,
        fetchCron: settings.fetchCron,
      },
      summary,
    });
    return summary;
  } finally {
    await releaseGuideLock(LOCK_ID);
  }
}

export async function runSerproDctfwebWorkerLoop() {
  let lastTickKey = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const settings = await getSerproRuntimeSettings();
      const now = new Date();
      const tickKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      // Agenda própria da rotina `inss` (antes era o fetchCron global, compartilhado com o PGDAS).
      const cfgInss = settings.rotinas?.inss;
      const inssBateu = cfgInss
        ? (cfgInss.enabled !== false && matchesCron(cfgInss.cron, now))
        : matchesCron(settings.fetchCron, now);

      if (settings.enabled && inssBateu && tickKey !== lastTickKey) {
        lastTickKey = tickKey;
        const result = await runSerproDctfwebWorkerOnce();
        log.info({ result, tickKey }, "Ciclo do serproDctfwebWorker concluído");
      }
    } catch (err) {
      log.error({ err: err?.message || err }, "Erro no ciclo do serproDctfwebWorker");
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
}

if (process.argv[1] && process.argv[1].endsWith("serproDctfwebWorker.js")) {
  const isOnce = process.argv.includes("--once");
  if (isOnce) {
    runSerproDctfwebWorkerOnce()
      .then((result) => {
        log.info({ result }, "serproDctfwebWorker --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "serproDctfwebWorker --once falhou");
        process.exit(1);
      });
  } else {
    runSerproDctfwebWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "serproDctfwebWorker loop fatal");
      process.exit(1);
    });
  }
}
