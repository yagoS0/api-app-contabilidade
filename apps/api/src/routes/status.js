import { Router } from "express";
import { prisma } from "../infrastructure/db/prisma.js";
import { PDF_READER_URL, SERPRO_PGDASD_WORKER_ENABLED } from "../config.js";

async function checkPdfReaderHealth() {
  const url = String(PDF_READER_URL || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("pdf_reader_url_not_configured");
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`pdf_reader_unhealthy_${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (body?.status !== "ok") throw new Error("pdf_reader_health_invalid_body");
  return "up";
}

export function createStatusRouter({ ensureAuthorized }) {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  router.get("/readyz", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.appSetting.findFirst({ select: { key: true } }).catch(() => null);
      const pdfReader = await checkPdfReaderHealth();
      return res.status(200).json({
        ok: true,
        db: "up",
        pdfReader,
      });
    } catch (err) {
      return res.status(503).json({
        ok: false,
        error: "service_not_ready",
        reason: err?.message || "service_not_ready",
      });
    }
  });

  router.get("/status", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const latestSerproRun = await prisma.appSetting.findFirst({
      where: { key: { startsWith: "serpro_pgdasd_log:" } },
      orderBy: { updatedAt: "desc" },
      select: { key: true, value: true, updatedAt: true },
    });
    res.json({
      ok: true,
      guides: {
        flow: "portal_upload_pdf_reader_postgres_email",
        // ⚠ Aqui ecoava `guideEmailWorkerEnabled: GUIDE_EMAIL_WORKER_ENABLED` — o ÚNICO consumidor
        // daquela flag em todo o projeto, e ele só a repetia. Não existia `if` nenhum atrás dela.
        // Ler `false` aqui parecia explicar "o envio de e-mail não está funcionando"; não explicava
        // nada, e mandou o diagnóstico para o lado errado (a causa real era o filtro que não casava
        // com `emailStatus` NULL, commit a61649d0).
        //
        // O que este endpoint pode afirmar com verdade é o MODO: desde a Q55 (`server.js`, "nada
        // roda sozinho") não há laço, e `emailNextRetryAt` é escrito mas nunca drenado. Um campo
        // constante incomoda menos que um campo que mente — e, se um dia o envio voltar a ser
        // automático, este bloco é o lugar que precisa mudar junto.
        emailDispatch: {
          mode: "manual",
          loopAutomatico: false,
          retryAutomatico: false,
          motivo: "Q55 — nada roda sozinho; o envio sai por clique (envio em lote / liberar ao cliente)",
        },
        serproPgdasdWorkerEnabled: SERPRO_PGDASD_WORKER_ENABLED,
        serproPgdasdLastRun: latestSerproRun
          ? {
              key: latestSerproRun.key,
              updatedAt: latestSerproRun.updatedAt,
              value: latestSerproRun.value,
            }
          : null,
      },
    });
  });

  return router;
}
