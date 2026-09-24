import { prepararAcompanhamentoParcelamentosEmpresa } from "../application/fiscal/serpro/ParcelamentoDescobertaService.js";
import { comContextoSerpro, contextoSerproAtual } from "../application/fiscal/serpro/serproCallContext.js";
import { log, INTEGRACAO_SERPRO_PARCELAMENTO } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { acquireGuideLease } from "../application/guides/GuideLockService.js";
import { getReferenceCompetencia } from "../application/guides/guideCompliance.js";
import { resolveCompanyNotificationEmail } from "../application/guides/GuideScheduledEmailService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { SerproProcurationService } from "../application/fiscal/serpro/SerproProcurationService.js";
import { capturePgdasGuideForCompany } from "../application/fiscal/serpro/CaptureSerproGuidesService.js";
import { capturarLpDaCompetencia } from "../application/fiscal/lp/LucroPresumidoProvisaoService.js";
import { syncPgdasByCompetencia } from "../application/fiscal/serpro/SerproPgdasDeclaracaoService.js";
import { capturarParcelaGuideForCompany } from "../application/fiscal/serpro/CaptureSerproParcelaService.js";
import { createSerproExecutionLog } from "../application/fiscal/serpro/SerproExecutionLogService.js";
import { idsComRotinaAtiva } from "../application/fiscal/serpro/CompanyRotinasService.js";
import { runRoutineLoop } from "./runRoutineLoop.js";
import { previousCompetencia } from "./routineSchedule.js";

const LOCK_ID = "serpro_pgdasd_capture_lock";
const LOCK_TTL_MS = 30 * 60 * 1000;
const LOOP_INTERVAL_MS = 60 * 1000;

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

    // eslint-disable-next-line no-await-in-loop
    const email = await resolveCompanyNotificationEmail(p.id);

    eligible.push({
      id: p.id, razao: p.razao, cnpj: p.cnpj, email,
      regimeTributario: regime,
      hasProlabore: Boolean(p.hasProlabore),
    });
  }
  return eligible;
}

export async function runSerproPgdasdWorkerOnce(options = {}) {
  const ctx = contextoSerproAtual();
  return comContextoSerpro({ ...ctx, origem: ctx.origem || "worker:serpro_pgdasd" }, () => executarPgdasd(options));
}
async function executarPgdasd(options = {}) {
  const lease = await acquireGuideLease(LOCK_ID, LOCK_TTL_MS);
  if (!lease) return { skipped: true, reason: "lock_active" };

  try {
    const settings = await getSerproRuntimeSettings();
    if (!settings.enabled) {
      return { skipped: true, reason: "serpro_disabled" };
    }

    const competencia = options.competencia || previousCompetencia();
    const companies = await listEligiblePortalCompanies();
    const procurationService = new SerproProcurationService();
    const results = [];
    const extratoResults = [];
    const parcelaResults = []; // Q22: guias de parcelamento trazidas pelo worker
    const startedAt = Date.now();

    const now = new Date();
    const fetchDay = settings.fetchDay ?? 5;
    const isCaptureWindow = now.getDate() >= fetchDay; // a partir do dia configurado

    // Rotinas: QUEM (CompanyRotina, por empresa) × QUANDO (agenda por rotina).
    // Antes isso era implícito — o regime decidia tudo dentro deste laço. O seed do
    // CompanyRotinasService reproduz a regra antiga, então ligar isto não muda nada.
    const agenda = settings.rotinas || {};
    const [idsDas, idsExtrato, idsPresumido, idsParcelamento] = await Promise.all([
      idsComRotinaAtiva("das"),
      idsComRotinaAtiva("extrato"),
      idsComRotinaAtiva("presumido"),
      idsComRotinaAtiva("parcelamento"),
    ]);
    // Cada rotina tem sua própria janela (dia do mês a partir do qual pode rodar).
    // Sem agenda salva, cai no fetchDay legado — mesma janela de antes.
    function janelaAberta(rotina) {
      return agenda[rotina]?.enabled !== false && (!options.routines || options.routines.includes(rotina));
    }

    for (const company of companies) {
      lease.assertActive();
      options.assertActive?.();
      if (![["das", idsDas], ["extrato", idsExtrato], ["presumido", idsPresumido], ["parcelamento", idsParcelamento]]
        .some(([key, ids]) => janelaAberta(key) && ids.has(company.id))) continue;
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

        // O acompanhamento fiscal independe da abertura contábil do acordo.
        if (INTEGRACAO_SERPRO_PARCELAMENTO && janelaAberta("parcelamento") && idsParcelamento.has(company.id)) {
          const preparacao = await prepararAcompanhamentoParcelamentosEmpresa({ portalClientId: company.id, assertActive: () => { lease.assertActive(); options.assertActive?.(); } });
          const descoberta = preparacao.resultado || preparacao;
          for (const erro of (descoberta.resultados || []).filter(item => item.ok === false)) {
            parcelaResults.push({ companyId: company.id, razao: company.razao, status: "erro", etapa: "localizacao", reason: erro.reason || erro.error });
          }
          // eslint-disable-next-line no-await-in-loop
          const parcelamentos = await prisma.parcelamento.findMany({
            // Q28 Fase 4: grupo "outros" (PGFN/estadual/municipal) NÃO integra SERPRO — fica fora.
            where: { portalClientId: company.id, status: "ATIVO", tipo: { in: ["PARCSN", "PARCMEI"] }, OR: [{ fiscalSituacao: null }, { fiscalSituacao: { notIn: ["QUITADO", "RESCINDIDO"] } }], numeroParcelamento: { not: null }, grupo: { not: "outros" } },

          });
          for (const parc of parcelamentos) {
            lease.assertActive();
            options.assertActive?.();
            try {
              // eslint-disable-next-line no-await-in-loop
              const r = await capturarParcelaGuideForCompany({ portalClientId: company.id, parcelamento: parc, log, assertActive: () => { lease.assertActive(); options.assertActive?.(); } });
              parcelaResults.push({ companyId: company.id, razao: company.razao, numeroParcelamento: parc.numeroParcelamento, status: r.ok === false && !(r.parcelas || []).some(p => p.status === "erro") ? "erro" : "consultado", parcelas: r.parcelas, reason: r.reason || null });
            } catch (err) {
              parcelaResults.push({ companyId: company.id, numeroParcelamento: parc.numeroParcelamento, status: "erro", reason: err?.code || err?.message });
            }
          }
        }

        if (company.regimeTributario === "LUCRO_PRESUMIDO") {
          if (janelaAberta("presumido") && idsPresumido.has(company.id)) {
            const cnpjDigits = String(company.cnpj || "").replace(/\D+/g, "");
            // eslint-disable-next-line no-await-in-loop
            const existingLp = await prisma.guide.findFirst({
              where: { sourceFileId: `serpro:dctfweb:lp:${cnpjDigits}:${competencia}`, status: "PROCESSED" },
              select: { id: true },
            });
            if (!existingLp) {
              try {
                // eslint-disable-next-line no-await-in-loop
                lease.assertActive(); options.assertActive?.();
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
          continue; // DAS e extrato abaixo são exclusivos do Simples.
        }

        if (company.regimeTributario !== "SIMPLES") continue;

        // Stage 1: Captura inicial (apenas no/após fetchDay e se ainda não houver guia para a competência)
        // eslint-disable-next-line no-await-in-loop
        const existingForCompetencia = await prisma.guide.findFirst({
          where: {
            portalClientId: company.id,
            source: "SERPRO",
            tipo: "SIMPLES",
            parcelamentoId: null,
            NOT: { sourceFileId: { startsWith: "PARC-" } },
            competencia,
            status: "PROCESSED",
          },
          select: { id: true },
        });

        if (janelaAberta("das") && idsDas.has(company.id) && !existingForCompetencia) {
          try {
            // eslint-disable-next-line no-await-in-loop
            lease.assertActive(); options.assertActive?.();
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
        if (janelaAberta("extrato") && idsExtrato.has(company.id)) {
          // eslint-disable-next-line no-await-in-loop
          const circ = await prisma.companyMonthlyCircular.findUnique({
            where: { portalClientId_competencia: { portalClientId: company.id, competencia } },
            select: { serproSyncStatus: true },
          });
          if (circ?.serproSyncStatus !== "SUCCESS") {
            try {
              // eslint-disable-next-line no-await-in-loop
              lease.assertActive(); options.assertActive?.();
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
      parcelasErro: parcelaResults.reduce((s, p) => s + (p.status === "erro" ? 1 : 0) + (p.parcelas || []).filter((x) => x.status === "erro").length, 0),
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
    await lease.release();
  }
}

export async function runSerproPgdasdWorkerLoop() {
  return runRoutineLoop({ worker: "SERPRO_PGDASD_WORKER_ENABLED", routines: ["das","extrato","presumido","parcelamento"], run: runSerproPgdasdWorkerOnce });
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
