// src/server-send-only.js
import express from "express";
import cron from "node-cron";
import bodyParser from "body-parser";
import { run } from "./application/SendGuides.js";
import { log } from "./config.js";
import { RunLogStore } from "./infrastructure/status/RunLogStore.js";

const app = express();
app.use(bodyParser.json());

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const RUN_TOKEN = (process.env.RUN_TOKEN || "").trim();
const CRON_SCHEDULE = (process.env.CRON_SCHEDULE || "").trim(); // ex: "0 8 * * 1-5"

let isRunning = false;
let lastRunStartedAt = null;
let lastRunFinishedAt = null;
let lastRunError = null;

function isAuthorized(req) {
  if (!RUN_TOKEN) return true;
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

// Página simples com botão único
app.get("/", (_req, res) => {
  const hasToken = Boolean(RUN_TOKEN);
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Enviar guias</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f7f7f8; color:#222; padding: 32px; }
    .card { background:#fff; max-width:640px; margin: 0 auto; border:1px solid #e6e6e7; border-radius:12px; padding:24px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
    h1 { font-size:20px; margin:0 0 8px; }
    p { color:#555; margin-top: 0; }
    button { appearance:none; border:0; background:#2563eb; color:#fff; padding:12px 16px; border-radius:8px; font-weight:600; cursor:pointer; }
    button[disabled]{ opacity:.6; cursor:not-allowed; }
    .row { display:flex; gap:12px; align-items:center; }
    input[type="password"], input[type="text"] { padding:10px 12px; border:1px solid #d7d7d9; border-radius:8px; width: 100%; }
    .muted { color:#777; font-size:12px; }
    .status { margin-top:16px; font-size: 13px; }
    .kvs { display:grid; grid-template-columns: 140px 1fr; gap:6px 10px; margin-top:8px; }
    .log { margin-top:12px; border-top:1px solid #e6e6e7; padding-top:12px; }
    .log ul { list-style:none; padding:0; margin:0; }
    .log li { padding:6px 0; border-bottom:1px dashed #eee; }
    .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; color:#fff; }
    .pill.ok { background:#16a34a; }
    .pill.run { background:#2563eb; }
    .pill.err { background:#b91c1c; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Envio de guias</h1>
    <p>Acione manualmente o fluxo de envio. Verifique o status abaixo.</p>
    <div class="row" style="${hasToken ? "" : "display:none"}">
      <input id="token" placeholder="Token (x-run-token)" ${hasToken ? "" : "disabled"} />
    </div>
    <div class="row" style="margin-top:12px">
      <button id="runBtn">Enviar agora</button>
      <button id="refreshBtn" style="background:#334155">Atualizar status</button>
    </div>
    <div class="status" id="status"></div>
    <p class="muted">CRON: ${CRON_SCHEDULE || "desabilitado"}</p>
  </div>
  <script>
    const statusEl = document.getElementById('status');
    let poll = null;

    function fmt(t){
      try { return new Date(t).toLocaleString(); } catch { return t || '-' }
    }

    function renderStatus(j){
      const running = !!j.running;
      const err = j.lastRunError?.message || j.lastRunStore?.error?.message || null;
      const msgs = Array.isArray(j.messages) ? j.messages : [];
      const pill = running ? '<span class="pill run">Em execução</span>' : (err ? '<span class="pill err">Falhou</span>' : '<span class="pill ok">Pronto</span>');
      const list = msgs.map(m => {
        const when = m.timeISO ? new Date(m.timeISO).toLocaleTimeString() : '-';
        const who = m.cliente ? \`\${m.cliente} <span class="muted">(\${m.to})</span>\` : m.to;
        const mes = m.mes ? \` — \${m.mes}\` : '';
        return \`<li>[\${when}] Enviado para: <b>\${who}</b>\${mes}</li>\`;
      }).join('') || '<li class="muted">Sem mensagens nesta execução.</li>';

      statusEl.innerHTML = \`
        <div class="kvs">
          <div>Status</div><div>\${pill}</div>
          <div>Início</div><div>\${fmt(j.lastRunStartedAt || j.lastRunStore?.startedAt)}</div>
          <div>Fim</div><div>\${fmt(j.lastRunFinishedAt || j.lastRunStore?.finishedAt)}</div>
          <div>CRON</div><div>\${j.cron || 'desabilitado'}</div>
          \${err ? \`<div>Erro</div><div style="color:#b91c1c">\${err}</div>\` : ''}
        </div>
        <div class="log">
          <h3 style="margin:8px 0 8px">Log de envios</h3>
          <ul>\${list}</ul>
        </div>
      \`;
    }

    async function loadStatus(){
      const res = await fetch('/status');
      const j = await res.json();
      renderStatus(j);
      if (j.running && !poll) {
        poll = setInterval(loadStatus, 1500);
      } else if (!j.running && poll) {
        clearInterval(poll);
        poll = null;
      }
    }
    async function runNow(){
      const token = document.getElementById('token')?.value || '';
      const headers = {};
      if (token) headers['x-run-token'] = token;
      const btn = document.getElementById('runBtn');
      btn.disabled = true;
      try{
        const res = await fetch('/run', { method: 'POST', headers });
        const j = await res.json().catch(()=>({}));
        alert(res.ok ? 'Execução iniciada' : ('Falha: ' + (j.error || res.status)));
      } finally {
        btn.disabled = false;
        loadStatus();
      }
    }
    document.getElementById('runBtn').addEventListener('click', runNow);
    document.getElementById('refreshBtn').addEventListener('click', loadStatus);
    loadStatus();
  </script>
</body>
</html>`;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(200).send(html);
});

// Inicia o servidor
app.listen(PORT, HOST, () => {
  log.info({ port: PORT, host: HOST }, "Servidor (send-only) iniciado");
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


