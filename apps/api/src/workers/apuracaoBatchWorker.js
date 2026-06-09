// Q15.6 — Worker da fila de transmissão de apurações ao SERPRO.
//
// Processa ApuracaoBatchItem (status pendente) em lotes pequenos, respeitando
// throttling + custo SERPRO. Lock global (1 processador por vez). Falha isolada
// por item (não derruba o lote). Consulta-antes-de-transmitir (via FechamentoService).
//
// Opt-in por env APURACAO_BATCH_WORKER_ENABLED=1 (igual aos outros workers).

import { log } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { transmitirFechamento } from "../application/notas/apuracao/v2/FechamentoService.js";

const LOCK_ID = "apuracao_batch_lock";
const LOCK_TTL_MS = 15 * 60 * 1000;
const LOOP_INTERVAL_MS = 30 * 1000;
const ITEMS_POR_CICLO = 4;   // cap por ciclo (throttling/custo SERPRO)
const MAX_TENTATIVAS = 3;
const BACKOFF_MS = 5 * 60 * 1000;

/**
 * Processa 1 item da fila (idempotente; consulta-antes via FechamentoService).
 */
async function processarItem(item) {
  await prisma.apuracaoBatchItem.update({
    where: { id: item.id },
    data: { status: "processando", tentativas: { increment: 1 } },
  });
  try {
    const result = await transmitirFechamento({
      portalClientId: item.portalClientId,
      competencia: item.competencia,
    });
    await prisma.apuracaoBatchItem.update({
      where: { id: item.id },
      data: {
        status: "ok",
        dasValor: result?.snapshot?.dasRetornadoSerpro ?? null,
        numeroDeclaracao: result?.snapshot?.numeroDeclaracao ?? null,
        erroMensagem: result?.jaDeclarado ? "PA já declarado (não retransmitido)" : null,
        processadoEm: new Date(),
      },
    });
    return { ok: true };
  } catch (err) {
    const transitorio = /timeout|429|ETIMEDOUT|ECONNRESET|throttl/i.test(String(err?.message || ""));
    const podeReatentar = transitorio && item.tentativas + 1 < MAX_TENTATIVAS;
    await prisma.apuracaoBatchItem.update({
      where: { id: item.id },
      data: podeReatentar
        ? { status: "pendente", backoffUntil: new Date(Date.now() + BACKOFF_MS), erroMensagem: `retry: ${err?.message}`.slice(0, 400) }
        : { status: "erro", erroMensagem: `[${err?.code || "ERR"}] ${err?.message}`.slice(0, 400), processadoEm: new Date() },
    });
    return { ok: false, reatentou: podeReatentar };
  }
}

/** Atualiza contadores do job e fecha quando não há mais pendentes. */
async function atualizarJob(jobId) {
  const items = await prisma.apuracaoBatchItem.findMany({ where: { jobId }, select: { status: true } });
  const okCount = items.filter((i) => i.status === "ok").length;
  const errorCount = items.filter((i) => i.status === "erro").length;
  const pendenteCount = items.filter((i) => i.status === "pendente" || i.status === "processando").length;
  const concluido = pendenteCount === 0;
  await prisma.apuracaoBatchJob.update({
    where: { id: jobId },
    data: {
      processadas: okCount + errorCount,
      okCount, errorCount, pendenteCount,
      status: concluido ? "completed" : "running",
      concluidoEm: concluido ? new Date() : null,
    },
  });
}

/** Roda 1 ciclo: pega até ITEMS_POR_CICLO itens prontos e processa. */
export async function runApuracaoBatchOnce() {
  const agora = new Date();
  const itens = await prisma.apuracaoBatchItem.findMany({
    where: {
      status: "pendente",
      OR: [{ backoffUntil: null }, { backoffUntil: { lte: agora } }],
    },
    orderBy: { createdAt: "asc" },
    take: ITEMS_POR_CICLO,
  });
  if (itens.length === 0) return { processados: 0 };

  const jobsTocados = new Set();
  for (const item of itens) {
    await processarItem(item);
    jobsTocados.add(item.jobId);
  }
  for (const jobId of jobsTocados) await atualizarJob(jobId);
  return { processados: itens.length };
}

let running = false;
export async function runApuracaoBatchLoop() {
  if (running) return;
  running = true;
  log.info("apuracaoBatchWorker loop iniciado");
  for (;;) {
    const got = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
    if (got) {
      try {
        const { processados } = await runApuracaoBatchOnce();
        if (processados > 0) log.info({ processados }, "apuracaoBatchWorker ciclo");
      } catch (err) {
        log.warn({ err: err?.message || err }, "apuracaoBatchWorker erro no ciclo");
      } finally {
        await releaseGuideLock(LOCK_ID);
      }
    }
    await new Promise((r) => setTimeout(r, LOOP_INTERVAL_MS));
  }
}

/**
 * Cria um job de lote a partir de N empresas fechadas pra uma competência.
 * @returns {Promise<{jobId, totalEmpresas}>}
 */
export async function criarBatchJob({ portalClientIds, competencia, userId }) {
  if (!Array.isArray(portalClientIds) || portalClientIds.length === 0) {
    const e = new Error("Sem empresas selecionadas"); e.code = "NO_COMPANIES"; throw e;
  }
  // só empresas com snapshot em estado "fechada" entram
  const snaps = await prisma.apuracaoSnapshot.findMany({
    where: { portalClientId: { in: portalClientIds }, competencia, estado: "fechada" },
    select: { portalClientId: true },
  });
  const elegiveis = snaps.map((s) => s.portalClientId);
  if (elegiveis.length === 0) {
    const e = new Error("Nenhuma das empresas selecionadas está 'fechada' pra apurar"); e.code = "NONE_CLOSED"; throw e;
  }
  const job = await prisma.apuracaoBatchJob.create({
    data: {
      acao: "TRANSMITIR", competencia,
      totalEmpresas: elegiveis.length, pendenteCount: elegiveis.length,
      status: "running", triggeredBy: userId || null,
    },
  });
  await prisma.apuracaoBatchItem.createMany({
    data: elegiveis.map((pcId) => ({ jobId: job.id, portalClientId: pcId, competencia, status: "pendente" })),
  });
  return { jobId: job.id, totalEmpresas: elegiveis.length, ignoradas: portalClientIds.length - elegiveis.length };
}
