// Q62 — Download em lote das SITFIS (situação fiscal): ZIP com os PDFs já armazenados por empresa
// (CompanyFiscalStatus.relatorioPdfFileId). Job fire-and-forget no próprio processo, streaming pra
// disco (archiver → WriteStream), 1 job por vez via GuideLockService. Molde: NotasDownloadService (Q48).

import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../../guides/GuideLockService.js";
import { GuideStorageService } from "../../guides/GuideStorageService.js";
import { log } from "../../../config.js";

const LOCK_ID = "sitfis_download_lock";
const LOCK_TTL_MS = 15 * 60 * 1000;
const LOCK_RETRIES = 5;
const LOCK_RETRY_DELAY_MS = 5000;
const EXPIRA_DIAS = 7;
const ORFAO_MINUTOS = 10;
const STORAGE_DIR = (process.env.NOTAS_DOWNLOAD_STORAGE_PATH || "./storage/downloads").trim();

function safeFilePart(value) {
  return String(value || "").trim().replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
}
async function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
function removeFileQuiet(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* best-effort */ }
}

export async function cleanupSitfisDownloadJobs() {
  const now = new Date();
  try {
    const vencidos = await prisma.sitfisDownloadJob.findMany({
      where: { status: "concluido", expiresAt: { lt: now } },
      select: { id: true, arquivoPath: true },
    });
    for (const j of vencidos) {
      removeFileQuiet(j.arquivoPath);
      await prisma.sitfisDownloadJob.update({ where: { id: j.id }, data: { status: "expirado", arquivoPath: null } }).catch(() => null);
    }
    const limiteOrfao = new Date(Date.now() - ORFAO_MINUTOS * 60 * 1000);
    await prisma.sitfisDownloadJob.updateMany({
      where: { status: "processando", updatedAt: { lt: limiteOrfao } },
      data: { status: "erro", erroMensagem: "Processamento interrompido (servidor reiniciado?) — gere o download novamente." },
    });
  } catch (err) {
    log.warn({ err: err?.message || err }, "sitfis-download: cleanup falhou (best-effort)");
  }
}

export async function criarSitfisDownloadJob({ companyIds, userId }) {
  const ids = Array.isArray(companyIds) ? companyIds.map((x) => String(x)).filter(Boolean) : [];
  if (!ids.length) {
    const err = new Error("Selecione ao menos uma empresa.");
    err.code = "COMPANIES_REQUIRED";
    throw err;
  }
  await cleanupSitfisDownloadJobs();
  const job = await prisma.sitfisDownloadJob.create({
    data: { companyIds: ids, totalEmpresas: ids.length, triggeredBy: userId ? String(userId) : null },
  });
  processarSitfisDownloadJob(job.id).catch((err) => {
    log.error({ err: err?.message || err, jobId: job.id }, "sitfis-download: processamento fatal");
  });
  return { ok: true, jobId: job.id };
}

export async function processarSitfisDownloadJob(jobId) {
  const job = await prisma.sitfisDownloadJob.findUnique({ where: { id: String(jobId) } });
  if (!job || job.status !== "processando") return;

  let locked = false;
  for (let i = 0; i < LOCK_RETRIES; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    locked = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
    if (locked) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(LOCK_RETRY_DELAY_MS);
  }
  if (!locked) {
    await prisma.sitfisDownloadJob.update({
      where: { id: job.id },
      data: { status: "erro", erroMensagem: "Outro download em andamento — tente novamente em alguns minutos." },
    }).catch(() => null);
    return;
  }

  const ids = Array.isArray(job.companyIds) ? job.companyIds.map(String) : [];
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const arquivoNome = `situacao-fiscal-${job.id.slice(0, 8)}.zip`;
  const arquivoPath = path.join(STORAGE_DIR, `sitfis-${job.id}.zip`);
  const storage = GuideStorageService.create();

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

    let processadas = 0;
    let comPdf = 0;
    for (const companyId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const company = await prisma.portalClient.findUnique({ where: { id: companyId }, select: { razao: true, cnpj: true } });
      // eslint-disable-next-line no-await-in-loop
      const status = await prisma.companyFiscalStatus.findUnique({
        where: { portalClientId: companyId },
        select: { relatorioPdfFileId: true, situacao: true },
      });
      const cnpj = String(company?.cnpj || "").replace(/\D+/g, "");
      const nome = `${safeFilePart(company?.razao || "empresa").slice(0, 40) || "empresa"}-${cnpj || safeFilePart(companyId).slice(0, 8)}`;
      if (status?.relatorioPdfFileId) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const buf = await storage.downloadBuffer({ key: status.relatorioPdfFileId });
          if (buf?.length) {
            const sit = safeFilePart(status.situacao || "").toLowerCase();
            archive.append(buf, { name: `${nome}${sit ? `_${sit}` : ""}.pdf` });
            comPdf += 1;
          }
        } catch { /* empresa sem PDF acessível — pula */ }
      }
      processadas += 1;
      // eslint-disable-next-line no-await-in-loop
      await prisma.sitfisDownloadJob.update({ where: { id: job.id }, data: { processadas, comPdf } }).catch(() => null);
    }

    await archive.finalize();
    await finalizado;

    const stat = fs.statSync(arquivoPath);
    await prisma.sitfisDownloadJob.update({
      where: { id: job.id },
      data: {
        status: "concluido", arquivoPath, arquivoNome, arquivoBytes: stat.size,
        processadas, comPdf, expiresAt: new Date(Date.now() + EXPIRA_DIAS * 24 * 60 * 60 * 1000),
      },
    });
    log.info({ jobId: job.id, comPdf }, "sitfis-download: concluído");
  } catch (err) {
    removeFileQuiet(arquivoPath);
    await prisma.sitfisDownloadJob.update({
      where: { id: job.id },
      data: { status: "erro", erroMensagem: String(err?.message || err).slice(0, 500) },
    }).catch(() => null);
    log.error({ err: err?.message || err, jobId: job.id }, "sitfis-download: falhou");
  } finally {
    await releaseGuideLock(LOCK_ID);
  }
}

export function sitfisJobToResponse(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    totalEmpresas: job.totalEmpresas,
    processadas: job.processadas,
    comPdf: job.comPdf,
    arquivoNome: job.arquivoNome,
    arquivoBytes: job.arquivoBytes,
    erroMensagem: job.erroMensagem,
    expiresAt: job.expiresAt,
    createdAt: job.createdAt,
  };
}
