// src/server.js
import express from "express";
import cron from "node-cron";
import bodyParser from "body-parser";
import cors from "cors";
import { run } from "./application/SendGuides.js";
import { runInbox } from "./application/ProcessInbox.js";
import { log } from "./config.js";
import { RunLogStore } from "./infrastructure/status/RunLogStore.js";

const app = express();
app.use(bodyParser.json());
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["content-type", "x-run-token"],
  })
);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const RUN_TOKEN = (process.env.RUN_TOKEN || "").trim();
const CRON_SCHEDULE = (process.env.CRON_SCHEDULE || "").trim(); // ex: "0 8 * * 1-5"

let isRunning = false;
let lastRunStartedAt = null;
let lastRunFinishedAt = null;
let lastRunError = null;

function isAuthorized(req) {
  if (!RUN_TOKEN) return true; // sem token configurado => livre
  const headerToken = (req.get("x-run-token") || "").trim();
  const queryToken = (req.query.token || "").toString().trim();
  return headerToken === RUN_TOKEN || queryToken === RUN_TOKEN;
}

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/status", async (_req, res) => {
  const last = await RunLogStore.getLastRun();
  res.json({
    running: isRunning || Boolean(last?.running),
    lastRunStartedAt,
    lastRunFinishedAt,
    lastRunError:
      lastRunError && typeof lastRunError === "object"
        ? { message: lastRunError.message }
        : lastRunError || null,
    cron: CRON_SCHEDULE || null,
    messages: Array.isArray(last?.messages) ? last.messages : [],
    lastRunKind: last?.kind || null,
    lastRunStore: {
      startedAt: last?.startedAt || null,
      finishedAt: last?.finishedAt || null,
      error: last?.error || null,
      running: Boolean(last?.running),
    },
  });
});

app.post("/run", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (isRunning) {
    return res.status(409).json({ error: "already_running" });
  }
  // dispara em background
  res.status(202).json({ status: "started" });
  isRunning = true;
  lastRunError = null;
  lastRunStartedAt = new Date().toISOString();
  try {
    await RunLogStore.startRun("send");
    await run();
  } catch (err) {
    lastRunError = err;
    log.error({ err }, "Execução falhou");
  } finally {
    isRunning = false;
    lastRunFinishedAt = new Date().toISOString();
    await RunLogStore.finishRun({ error: lastRunError });
  }
});

app.post("/run-inbox", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (isRunning) {
    return res.status(409).json({ error: "already_running" });
  }
  res.status(202).json({ status: "started" });
  isRunning = true;
  lastRunError = null;
  lastRunStartedAt = new Date().toISOString();
  try {
    await RunLogStore.startRun("inbox");
    await runInbox();
  } catch (err) {
    lastRunError = err;
    log.error({ err }, "Execução (inbox) falhou");
  } finally {
    isRunning = false;
    lastRunFinishedAt = new Date().toISOString();
    await RunLogStore.finishRun({ error: lastRunError });
  }
});

// Página simples com botão
// (rota "/" removida — backend expõe somente APIs)

// Inicia o servidor
app.listen(PORT, HOST, () => {
  log.info({ port: PORT, host: HOST }, "Servidor iniciado");
});

// Agenda (se configurado)
if (CRON_SCHEDULE) {
  try {
    cron.schedule(
      CRON_SCHEDULE,
      async () => {
        if (isRunning) {
          log.warn("Execução cron ignorada: já há um processo em andamento.");
          return;
        }
        log.info({ CRON_SCHEDULE }, "Disparando execução pelo CRON");
        isRunning = true;
        lastRunError = null;
        lastRunStartedAt = new Date().toISOString();
        try {
          await RunLogStore.startRun("send");
          await run();
        } catch (err) {
          lastRunError = err;
          log.error({ err }, "Execução (cron) falhou");
        } finally {
          isRunning = false;
          lastRunFinishedAt = new Date().toISOString();
          await RunLogStore.finishRun({ error: lastRunError });
        }
      },
      {
        timezone: process.env.TZ || "America/Sao_Paulo",
      }
    );
    log.info({ CRON_SCHEDULE }, "CRON habilitado");
  } catch (e) {
    log.error({ err: e, CRON_SCHEDULE }, "Falha ao configurar CRON — desabilitado");
  }
}


