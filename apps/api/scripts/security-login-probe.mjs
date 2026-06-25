// Q27 — Prova de segurança da rota de login. Roda com `node` contra a API NO AR.
// Uso:  API_BASE=http://localhost:3000 [TEST_EMAIL=user@x.com] node scripts/security-login-probe.mjs
// Idealmente rode contra uma API recém-iniciada (rate-limit/lockout são em memória).
// Usa node:http (sem depender de fetch global, que não existe em Node antigo).
import http from "node:http";
import { URL } from "node:url";

const API_BASE = process.env.API_BASE || "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_EMAIL || ""; // e-mail que EXISTE (p/ teste de paridade de tempo)

function post(path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(API_BASE + path);
    const data = Buffer.from(JSON.stringify(body));
    const t0 = process.hrtime.bigint();
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": data.length } },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          let json = {};
          try { json = JSON.parse(raw || "{}"); } catch { /* ignore */ }
          resolve({ status: res.statusCode, body: json, ms });
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const rand = () => Math.random().toString(36).slice(2);

async function main() {
  console.log(`# Probe de login → ${API_BASE}\n`);

  // 1) Credenciais inválidas → 401 genérico (não vaza se o e-mail existe)
  const inexistente = await post("/auth/login", { identifier: `nao_existe_${rand()}@x.com`, password: "Xx1!aaaa" });
  check("e-mail inexistente → 401 invalid_credentials",
    inexistente.status === 401 && inexistente.body?.error === "invalid_credentials",
    `status=${inexistente.status} error=${inexistente.body?.error}`);

  // 2) Paridade de tempo (anti timing-oracle) — só se TEST_EMAIL informado
  if (TEST_EMAIL) {
    const N = 8;
    const tInex = []; const tWrong = [];
    for (let i = 0; i < N; i++) { tInex.push((await post("/auth/login", { identifier: `z_${rand()}@x.com`, password: "Xx1!aaaa" })).ms); }
    for (let i = 0; i < N; i++) { tWrong.push((await post("/auth/login", { identifier: TEST_EMAIL, password: "Xx1!errado" })).ms); }
    const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const ai = avg(tInex); const aw = avg(tWrong);
    const diffPct = Math.abs(ai - aw) / Math.max(ai, aw) * 100;
    check("paridade de tempo (inexistente vs senha errada)", diffPct < 40,
      `inexistente=${ai.toFixed(1)}ms senha-errada=${aw.toFixed(1)}ms diff=${diffPct.toFixed(0)}%`);
  } else {
    console.log("SKIP  paridade de tempo (defina TEST_EMAIL=um-email-existente)");
  }

  // 3) Senha fraca no signup → 400 weak_password
  const weak = await post("/auth/signup", { email: `novo_${rand()}@x.com`, password: "12345678" });
  check("signup senha fraca → 400 weak_password",
    weak.status === 400 && weak.body?.error === "weak_password",
    `status=${weak.status} error=${weak.body?.error}`);

  // 4) Trava por conta: N falhas no MESMO e-mail → account_locked
  const alvo = `lock_${rand()}@x.com`;
  let lockHit = null;
  for (let i = 0; i < 7; i++) {
    const r = await post("/auth/login", { identifier: alvo, password: `Xx1!err${i}` });
    if (r.body?.error === "account_locked") { lockHit = r; break; }
  }
  check("trava por conta após N falhas → account_locked",
    Boolean(lockHit) && lockHit.status === 429,
    lockHit ? `retryAfterSec=${lockHit.body?.retryAfterSec}` : "não travou (rode contra API recém-iniciada)");

  // 5) Rate-limit por IP: rajada → algum 429
  let got429 = false;
  for (let i = 0; i < 14; i++) {
    const r = await post("/auth/login", { identifier: `burst_${rand()}@x.com`, password: "Xx1!aaaa" });
    if (r.status === 429) { got429 = true; break; }
  }
  check("rate-limit por IP → 429 na rajada", got429, got429 ? "" : "não disparou (limite pode ter resetado)");

  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} PASS`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((err) => { console.error("Erro no probe:", err.message); process.exit(2); });
