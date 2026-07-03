// Q48 — Download de notas em lote: gera um ZIP (pasta por empresa) com os XMLs já armazenados em
// PortalInvoice.xmlRaw, filtrado por período/tipo/papel. O job roda EM SEGUNDO PLANO no próprio
// processo da API (fire-and-forget, padrão dos workers do server.js) sem travar o event loop:
// streaming do ZIP direto pra disco (archiver → WriteStream, nunca em memória), paginação keyset
// (lotes de 200) e yield (setImmediate) entre lotes. 1 job por vez via GuideLockService.
// O frontend acompanha por polling e baixa o arquivo pronto; o zip expira em 7 dias.

import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../../guides/GuideLockService.js";
import { log } from "../../../config.js";

const LOCK_ID = "notas_download_lock";
const LOCK_TTL_MS = 15 * 60 * 1000;
const LOCK_RETRIES = 5;
const LOCK_RETRY_DELAY_MS = 5000;
const PAGE_SIZE = 200;
const MAX_MESES = 12; // mesma regra do expandRange das Funções SERPRO
const EXPIRA_DIAS = 7;
const ORFAO_MINUTOS = 10; // job "processando" sem update há 10min = interrompido (ex.: restart)

// Mesmo padrão do CERT_STORAGE_PATH: env com fallback local (storage/ já está no .gitignore).
const STORAGE_DIR = (process.env.NOTAS_DOWNLOAD_STORAGE_PATH || "./storage/downloads").trim();

function safeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCompetencia(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

// Range DateTime inclusivo [1º dia De, último instante Até] — mesmo critério do GET /notas.
function competenciaRange(de, ate) {
  const start = new Date(Date.UTC(de.year, de.month - 1, 1));
  const end = new Date(Date.UTC(ate.year, ate.month, 0, 23, 59, 59, 999));
  return { start, end };
}

function monthsBetween(de, ate) {
  return (ate.year * 12 + ate.month) - (de.year * 12 + de.month) + 1;
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function yieldEventLoop() {
  return new Promise((res) => setImmediate(res));
}

function removeFileQuiet(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* best-effort */ }
}

// Cleanup best-effort: expira zips vencidos e marca jobs "processando" órfãos como erro.
export async function cleanupNotasDownloadJobs() {
  const now = new Date();
  try {
    const vencidos = await prisma.notasDownloadJob.findMany({
      where: { status: "concluido", expiresAt: { lt: now } },
      select: { id: true, arquivoPath: true },
    });
    for (const j of vencidos) {
      removeFileQuiet(j.arquivoPath);
      await prisma.notasDownloadJob.update({
        where: { id: j.id },
        data: { status: "expirado", arquivoPath: null },
      }).catch(() => null);
    }
    const limiteOrfao = new Date(Date.now() - ORFAO_MINUTOS * 60 * 1000);
    await prisma.notasDownloadJob.updateMany({
      where: { status: "processando", updatedAt: { lt: limiteOrfao } },
      data: { status: "erro", erroMensagem: "Processamento interrompido (servidor reiniciado?) — gere o download novamente." },
    });
  } catch (err) {
    log.warn({ err: err?.message || err }, "notas-download: cleanup falhou (best-effort)");
  }
}

/**
 * Cria o job e dispara o processamento em segundo plano (fire-and-forget).
 * Retorna { ok, jobId } imediatamente — o frontend acompanha por polling.
 */
export async function criarNotasDownloadJob({ companyIds, competenciaDe, competenciaAte, tipo, papel, userId }) {
  const ids = Array.isArray(companyIds) ? companyIds.map((x) => String(x)).filter(Boolean) : [];
  if (!ids.length) {
    const err = new Error("Selecione ao menos uma empresa.");
    err.code = "COMPANIES_REQUIRED";
    throw err;
  }
  const de = parseCompetencia(competenciaDe);
  const ate = parseCompetencia(competenciaAte);
  if (!de || !ate) {
    const err = new Error("Informe o período De/Até (YYYY-MM).");
    err.code = "PERIODO_INVALIDO";
    throw err;
  }
  const meses = monthsBetween(de, ate);
  if (meses < 1) {
    const err = new Error("A data inicial (De) não pode ser depois da final (Até).");
    err.code = "PERIODO_INVALIDO";
    throw err;
  }
  if (meses > MAX_MESES) {
    const err = new Error(`Intervalo máximo de ${MAX_MESES} meses por download.`);
    err.code = "PERIODO_MUITO_LONGO";
    throw err;
  }
  const tipoNorm = ["NFE", "NFSE"].includes(String(tipo || "").toUpperCase()) ? String(tipo).toUpperCase() : null;
  const papelNorm = ["EMIT", "DEST"].includes(String(papel || "").toUpperCase()) ? String(papel).toUpperCase() : null;

  await cleanupNotasDownloadJobs();

  const job = await prisma.notasDownloadJob.create({
    data: {
      competenciaDe,
      competenciaAte,
      tipo: tipoNorm,
      papel: papelNorm,
      companyIds: ids,
      totalEmpresas: ids.length,
      triggeredBy: userId ? String(userId) : null,
    },
  });

  // Fire-and-forget: o processamento roda async no mesmo processo (I/O-bound) sem segurar a request.
  processarNotasDownloadJob(job.id).catch((err) => {
    log.error({ err: err?.message || err, jobId: job.id }, "notas-download: processamento fatal");
  });

  return { ok: true, jobId: job.id };
}

/** Processa o job: gera o ZIP em disco com streaming. Nunca lança pra fora (persiste erro no job). */
export async function processarNotasDownloadJob(jobId) {
  const job = await prisma.notasDownloadJob.findUnique({ where: { id: String(jobId) } });
  if (!job || job.status !== "processando") return;

  // 1 job por vez — re-tenta o lock algumas vezes antes de desistir.
  let locked = false;
  for (let i = 0; i < LOCK_RETRIES; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    locked = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
    if (locked) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(LOCK_RETRY_DELAY_MS);
  }
  if (!locked) {
    await prisma.notasDownloadJob.update({
      where: { id: job.id },
      data: { status: "erro", erroMensagem: "Outro download em andamento — tente novamente em alguns minutos." },
    }).catch(() => null);
    return;
  }

  const de = parseCompetencia(job.competenciaDe);
  const ate = parseCompetencia(job.competenciaAte);
  const { start, end } = competenciaRange(de, ate);
  const ids = Array.isArray(job.companyIds) ? job.companyIds.map(String) : [];

  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const arquivoNome = `notas-${job.competenciaDe}_${job.competenciaAte}-${job.id.slice(0, 8)}.zip`;
  const arquivoPath = path.join(STORAGE_DIR, `notas-${job.id}.zip`);

  let output = null;
  try {
    output = fs.createWriteStream(arquivoPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    const finalizado = new Promise((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
    });
    archive.pipe(output);

    let totalNotas = 0;
    let processadas = 0;

    for (const companyId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const company = await prisma.portalClient.findUnique({
        where: { id: companyId },
        select: { razao: true, cnpj: true },
      });
      const cnpj = String(company?.cnpj || "").replace(/\D+/g, "");
      const folder = `${safeFilePart(company?.razao || "empresa").slice(0, 40) || "empresa"}-${cnpj || safeFilePart(companyId).slice(0, 8)}`;

      const where = {
        clientId: companyId,
        xmlRaw: { not: null },
        competencia: { gte: start, lte: end },
        ...(job.tipo ? { type: job.tipo } : {}),
        ...(job.papel ? { papel: job.papel } : {}),
      };

      // Keyset por id — nunca carrega tudo de uma vez (lotes de PAGE_SIZE).
      let cursorId = null;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const lote = await prisma.portalInvoice.findMany({
          where,
          orderBy: { id: "asc" },
          take: PAGE_SIZE,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
          select: { id: true, type: true, numero: true, chaveAcesso: true, issueDate: true, xmlRaw: true },
        });
        if (!lote.length) break;

        for (const inv of lote) {
          if (!inv.xmlRaw) continue;
          const sub = String(inv.type || "nota").toLowerCase() === "nfe" ? "nfe" : "nfse";
          const n = safeFilePart(inv.numero || "");
          const ch = safeFilePart(inv.chaveAcesso || "");
          const date = inv.issueDate ? safeFilePart(new Date(inv.issueDate).toISOString().slice(0, 10)) : "";
          const base = n || ch || safeFilePart(inv.id);
          archive.append(inv.xmlRaw, { name: `${folder}/${sub}/${base}${date ? `_${date}` : ""}.xml` });
          totalNotas += 1;
        }

        cursorId = lote[lote.length - 1].id;
        // eslint-disable-next-line no-await-in-loop
        await yieldEventLoop(); // devolve o event loop entre lotes — não trava a API
        if (lote.length < PAGE_SIZE) break;
      }

      processadas += 1;
      // Progresso pro polling do frontend (também renova o updatedAt = heartbeat anti-órfão).
      // eslint-disable-next-line no-await-in-loop
      await prisma.notasDownloadJob.update({
        where: { id: job.id },
        data: { processadas, totalNotas },
      }).catch(() => null);
    }

    await archive.finalize();
    await finalizado;

    const stat = fs.statSync(arquivoPath);
    await prisma.notasDownloadJob.update({
      where: { id: job.id },
      data: {
        status: "concluido",
        arquivoPath,
        arquivoNome,
        arquivoBytes: stat.size,
        totalNotas,
        processadas,
        expiresAt: new Date(Date.now() + EXPIRA_DIAS * 24 * 60 * 60 * 1000),
      },
    });
    log.info({ jobId: job.id, totalNotas, bytes: stat.size }, "notas-download: concluído");
  } catch (err) {
    removeFileQuiet(arquivoPath);
    const msg = err?.message || String(err);
    await prisma.notasDownloadJob.update({
      where: { id: job.id },
      data: { status: "erro", erroMensagem: msg.slice(0, 500) },
    }).catch(() => null);
    log.error({ err: msg, jobId: job.id }, "notas-download: falhou");
  } finally {
    await releaseGuideLock(LOCK_ID);
  }
}

/** Shape do job pro frontend (sem expor o path do disco). */
export function jobToResponse(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    competenciaDe: job.competenciaDe,
    competenciaAte: job.competenciaAte,
    tipo: job.tipo,
    papel: job.papel,
    totalEmpresas: job.totalEmpresas,
    processadas: job.processadas,
    totalNotas: job.totalNotas,
    arquivoNome: job.arquivoNome,
    arquivoBytes: job.arquivoBytes,
    erroMensagem: job.erroMensagem,
    expiresAt: job.expiresAt,
    createdAt: job.createdAt,
  };
}
