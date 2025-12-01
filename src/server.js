// src/server.js
import express from "express";
import cron from "node-cron";
import bodyParser from "body-parser";
import cors from "cors";
import { run } from "./application/SendGuides.js";
import { log, API_KEYS } from "./config.js";
import { RunLogStore } from "./infrastructure/status/RunLogStore.js";

const app = express();
app.use(bodyParser.json());
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["content-type", "x-api-key"],
  })
);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const CRON_SCHEDULE = (process.env.CRON_SCHEDULE || "").trim(); // ex: "0 8 * * 1-5"

let isRunning = false;
let lastRunStartedAt = null;
let lastRunFinishedAt = null;
let lastRunError = null;

function extractApiKey(req) {
  const headerKey = (req.get("x-api-key") || "").trim();
  if (headerKey) return headerKey;
  const queryKey = (req.query.apiKey || req.query.apikey || req.query.api_key || "").toString().trim();
  return queryKey;
}

function ensureAuthorized(req, res) {
  if (!API_KEYS.length) return true; // sem chaves configuradas => livre (mas logamos no startup)
  const provided = extractApiKey(req);
  if (provided && API_KEYS.includes(provided)) return true;
  log.warn({ path: req.path, ip: req.ip }, "Chave de API ausente ou inválida");
  res.status(401).json({ error: "unauthorized" });
  return false;
}

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/status", async (req, res) => {
  if (!ensureAuthorized(req, res)) return;
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
  if (!ensureAuthorized(req, res)) return;
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


