import { log, INTEGRACAO_SERPRO_PARCELAMENTO } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { getReferenceCompetencia } from "../application/guides/guideCompliance.js";
import { resolveCompanyNotificationEmail } from "../application/guides/GuideScheduledEmailService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { SerproProcurationService } from "../application/fiscal/serpro/SerproProcurationService.js";
import { capturePgdasGuideForCompany } from "../application/fiscal/serpro/CaptureSerproGuidesService.js";
import { capturarLpDaCompetencia } from "../application/fiscal/lp/LucroPresumidoProvisaoService.js";
import { syncPgdasByCompetencia } from "../application/fiscal/serpro/SerproPgdasDeclaracaoService.js";
import { capturarParcelaGuideForCompany } from "../application/fiscal/serpro/CaptureSerproParcelaService.js";
import { createSerproExecutionLog } from "../application/fiscal/serpro/SerproExecutionLogService.js";

const LOCK_ID = "serpro_pgdasd_capture_lock";
const LOCK_TTL_MS = 30 * 60 * 1000;
const LOOP_INTERVAL_MS = 60 * 1000;

function parseCronField(field, value, min, max) {
  const raw = String(field || "*").trim();
  if (raw === "*") return true;

  return raw.split(",").some((part) => {
    const token = String(part || "").trim();
    if (!token) return false;

    const stepMatch = token.match(/^(\*|\d+-\d+|\d+)\/(\d+)$/);
    if (stepMatch) {
      const base = stepMatch[1];
      const step = Number(stepMatch[2]);
      if (!Number.isFinite(step) || step <= 0) return false;
      if (base === "*") return value >= min && value <= max && (value - min) % step === 0;
      if (base.includes("-")) {
        const [start, end] = base.split("-").map(Number);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        return value >= start && value <= end && (value - start) % step === 0;
      }
      const start = Number(base);
      return value === start;
    }

    if (token.includes("-")) {
      const [start, end] = token.split("-").map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return value >= start && value <= end;
    }

    const numeric = Number(token);
    return Number.isFinite(numeric) && numeric === value;
  });
}

function matchesCron(cronExpression, now = new Date()) {
  const parts = String(cronExpression || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return (
    parseCronField(minute, now.getMinutes(), 0, 59) &&
    parseCronField(hour, now.getHours(), 0, 23) &&
    parseCronField(dayOfMonth, now.getDate(), 1, 31) &&
    parseCronField(month, now.getMonth() + 1, 1, 12) &&
    parseCronField(dayOfWeek, now.getDay(), 0, 6)
  );
}

async function acquireLock() {
  return tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
}

async function releaseLockSafely() {
  await releaseGuideLock(LOCK_ID);
}

async function listEligiblePortalCompanies() {
  // PortalClient não tem relação `company` (só FK `companyId`). Buscamos Companies
  // separadamente e fazemos merge em memória pelo companyId.
  const portalRows = await prisma.portalClient.findMany({
    // Q11.1: empresas SUSPENSAS são puladas pelo worker SERPRO (não captura, não processa).
    where: { cnpj: { not: "" }, status: { not: "SUSPENSA" } },
    select: {
      id: true, razao: true, cnpj: true,
      guideNotificationEmail: true, hasProlabore: true, companyId: true,
    },
    orderBy: { razao: "asc" },
  });
  const legacyIds = portalRows.map((p) => p.companyId).filter(Boolean);
  const legacy = legacyIds.length > 0
    ? await prisma.company.findMany({
        where: { id: { in: legacyIds } },
        select: { id: true, regimeTributario: true, tipoTributario: true },
      })
    : [];
  const legacyMap = new Map(legacy.map((c) => [c.id, c]));

  const eligible = [];
  for (const p of portalRows) {
    const legacyRow = p.companyId ? legacyMap.get(p.companyId) : null;
    const regime = String(legacyRow?.regimeTributario || legacyRow?.tipoTributario || "")
      .trim()
      .toUpperCase();
    // Módulo Fiscal M2: o cron também processa Lucro Presumido (captura DCTFWeb → provisão).
    if (regime !== "SIMPLES" && regime !== "LUCRO_PRESUMIDO") continue;
    // eslint-disable-next-line no-await-in-loop
    const email = await resolveCompanyNotificationEmail(p.id);
    if (!email) continue;
    eligible.push({
      id: p.id, razao: p.razao, cnpj: p.cnpj, email,
      regimeTributario: regime,
      hasProlabore: Boolean(p.hasProlabore),
    });
  }
  return eligible;
}

export async function runSerproPgdasdWorkerOnce(options = {}) {
  const locked = await acquireLock();
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
    const extratoResults = [];
    const parcelaResults = []; // Q22: guias de parcelamento trazidas pelo worker
    const startedAt = Date.now();

    const now = new Date();
    const fetchDay = settings.fetchDay ?? 5;
    const isCaptureWindow = now.getDate() >= fetchDay; // a partir do dia configurado

    for (const company of companies) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const procuration = await procurationService.checkCompanyProcuration({ portalClientId: company.id });
        if (procuration.status !== "ATIVA") {
          results.push({
            companyId: company.id,
            razao: company.razao,
            cnpj: company.cnpj,
            email: company.email,
            competencia,
            status: "skipped_procuration_inactive",
            procurationStatus: procuration.status,
          });
          continue;
        }

        // Módulo Fiscal M2: Lucro Presumido → captura DCTFWeb (provisão por tributo + split na circular).
        // Idempotente: pula se já houver guia LP PROCESSED da competência (evita re-hit no SERPRO).
        if (company.regimeTributario === "LUCRO_PRESUMIDO") {
          if (isCaptureWindow) {
            const cnpjDigits = String(company.cnpj || "").replace(/\D+/g, "");
            // eslint-disable-next-line no-await-in-loop
            const existingLp = await prisma.guide.findFirst({
              where: { sourceFileId: `serpro:dctfweb:lp:${cnpjDigits}:${competencia}`, status: "PROCESSED" },
              select: { id: true },
            });
            if (!existingLp) {
              try {
                // eslint-disable-next-line no-await-in-loop
                const cap = await capturarLpDaCompetencia({ portalClientId: company.id, competencia });
                results.push({
                  companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
                  competencia, status: "lp_captured", debitos: cap.debitos?.length || 0,
                });
              } catch (err) {
                const naoTransmitida = err?.code === "SERPRO_DCTFWEB_LP_NAO_TRANSMITIDA";
                results.push({
                  companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
                  competencia,
                  status: naoTransmitida ? "lp_nao_transmitida" : "error",
                  error: naoTransmitida ? null : (err?.code || "SERPRO_DCTFWEB_LP_CAPTURE_FAILED"),
                  reason: err?.message || null,
                  retryable: Boolean(err?.retryable),
                });
              }
            }
          }
          continue; // LP não roda as stages de Simples (DAS/extrato/parcelamento)
        }

        // Stage 1: Captura inicial (apenas no/após fetchDay e se ainda não houver guia para a competência)
        // eslint-disable-next-line no-await-in-loop
        const existingForCompetencia = await prisma.guide.findFirst({
          where: {
            portalClientId: company.id,
            source: "SERPRO",
            tipo: "SIMPLES",
            competencia,
            status: "PROCESSED",
          },
          select: { id: true },
        });

        if (isCaptureWindow && !existingForCompetencia) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const capture = await capturePgdasGuideForCompany({
              portalClientId: company.id,
              competencia,
              // emailStatusOverride padrão = PENDING (envia email da captura inicial)
            });
            results.push({
              companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
              competencia,
              status: "captured",
              guideId: capture.guide.guideId,
              integration: capture.integration,
              serviceId: capture.integration?.servico || null,
            });
          } catch (err) {
            results.push({
              companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
              competencia,
              status: "error",
              error: err?.code || "SERPRO_PGDASD_CAPTURE_FAILED",
              reason: err?.message || "serpro_pgdasd_capture_failed",
              retryable: Boolean(err?.retryable),
            });
          }
        }

        // Stage 3 (Q17): extrato/declaração PGDAS-D → gera os lançamentos contábeis.
        // syncPgdasByCompetencia baixa o extrato e chama generateEntriesFromCircular.
        // Idempotente: só busca se a competência ainda não foi sincronizada com SUCESSO
        // (evita re-hit pago no SERPRO a cada ciclo). Isolado: falha não derruba o ciclo.
        if (isCaptureWindow) {
          // eslint-disable-next-line no-await-in-loop
          const circ = await prisma.companyMonthlyCircular.findUnique({
            where: { portalClientId_competencia: { portalClientId: company.id, competencia } },
            select: { serproSyncStatus: true },
          });
          if (circ?.serproSyncStatus !== "SUCCESS") {
            try {
              // eslint-disable-next-line no-await-in-loop
              await syncPgdasByCompetencia({ portalClientId: company.id, competencia });
              extratoResults.push({
                companyId: company.id, razao: company.razao, competencia, status: "extrato_ok",
              });
            } catch (err) {
              extratoResults.push({
                companyId: company.id, razao: company.razao, competencia,
                status: "extrato_erro",
                error: err?.code || "SERPRO_PGDASD_EXTRATO_FAILED",
                reason: err?.message || "serpro_pgdasd_extrato_failed",
              });
            }
          } else {
            extratoResults.push({ companyId: company.id, competencia, status: "extrato_ja_sincronizado" });
          }
        }

        // Stage 4 (Q22): guias de PARCELAMENTO. Atrás da flag INTEGRACAO_SERPRO_PARCELAMENTO.
        // Itera só os parcelamentos ATIVOS já criados na base (decisão do dono); para cada um,
        // lista as competências geráveis e traz a parcela (composição + PDF) → lançamento + guia.
        if (INTEGRACAO_SERPRO_PARCELAMENTO && isCaptureWindow) {
          // eslint-disable-next-line no-await-in-loop
          const parcelamentos = await prisma.parcelamento.findMany({
            // Q23: só busca automática depois que a 1ª parcela manual gerou a provisão (aberturaEntryId).
            // Q28 Fase 4: grupo "outros" (PGFN/estadual/municipal) NÃO integra SERPRO — fica fora.
            where: { portalClientId: company.id, status: "ATIVO", numeroParcelamento: { not: null }, aberturaEntryId: { not: null }, grupo: { not: "outros" } },
            select: { id: true, tipo: true, numeroParcelamento: true, totalValue: true, principalTotal: true, valorMulta: true, jurosTotal: true, numParcelas: true },
          });
          for (const parc of parcelamentos) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const r = await capturarParcelaGuideForCompany({ portalClientId: company.id, parcelamento: parc, log });
              parcelaResults.push({ companyId: company.id, razao: company.razao, numeroParcelamento: parc.numeroParcelamento, parcelas: r.parcelas, reason: r.reason || null });
            } catch (err) {
              parcelaResults.push({ companyId: company.id, numeroParcelamento: parc.numeroParcelamento, status: "erro", reason: err?.code || err?.message });
            }
          }
        }

        // Q54: Stage 2 (re-fetch diário das guias DAS OPEN) REMOVIDO. Re-buscar diariamente no
        // SERPRO uma guia já capturada sobrescrevia o valor (com juros/multa após o vencimento),
        // mesmo já paga no prazo → confusão contábil (mesmo problema que já corrigimos no INSS).
        // Toda busca automática do DAS passa a ser SÓ a captura mensal do Cron (Stage 1/3/4);
        // recálculo de guia específica é ação manual (botão "Recalcular").
      } catch (err) {
        results.push({
          companyId: company.id, razao: company.razao, cnpj: company.cnpj, email: company.email,
          competencia,
          status: "error",
          error: err?.code || "SERPRO_PGDASD_CYCLE_FAILED",
          reason: err?.message || "serpro_pgdasd_cycle_failed",
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
      failed: results.filter((item) => item.status === "error").length,
      skippedByProcuration: results.filter((item) => item.status === "skipped_procuration_inactive").length,
      extratoOk: extratoResults.filter((item) => item.status === "extrato_ok").length,
      extratoErro: extratoResults.filter((item) => item.status === "extrato_erro").length,
      extratoJaSincronizado: extratoResults.filter((item) => item.status === "extrato_ja_sincronizado").length,
      // Q22: parcelas trazidas (flatten dos resultados por parcelamento).
      parcelasOk: parcelaResults.reduce((s, p) => s + (p.parcelas || []).filter((x) => String(x.status).startsWith("ok")).length, 0),
      parcelasErro: parcelaResults.reduce((s, p) => s + (p.parcelas || []).filter((x) => x.status === "erro").length, 0),
      durationMs: Date.now() - startedAt,
      results,
      extratoResults,
      parcelaResults,
    };
    await createSerproExecutionLog({
      worker: "serpro_pgdasd",
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
    await releaseLockSafely();
  }
}

export async function runSerproPgdasdWorkerLoop() {
  let lastTickKey = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const settings = await getSerproRuntimeSettings();
      const now = new Date();
      const tickKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      if (settings.enabled && matchesCron(settings.fetchCron, now) && tickKey !== lastTickKey) {
        lastTickKey = tickKey;
        const result = await runSerproPgdasdWorkerOnce();
        log.info({ result, tickKey }, "Ciclo do serproPgdasdWorker concluído");
      }
    } catch (err) {
      log.error({ err: err?.message || err }, "Erro no ciclo do serproPgdasdWorker");
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
}

if (process.argv[1] && process.argv[1].endsWith("serproPgdasdWorker.js")) {
  const isOnce = process.argv.includes("--once");
  if (isOnce) {
    runSerproPgdasdWorkerOnce()
      .then((result) => {
        log.info({ result }, "serproPgdasdWorker --once finalizado");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "serproPgdasdWorker --once falhou");
        process.exit(1);
      });
  } else {
    runSerproPgdasdWorkerLoop().catch((err) => {
      log.error({ err: err?.message || err }, "serproPgdasdWorker loop fatal");
      process.exit(1);
    });
  }
}
