#!/usr/bin/env node
// Executa o modelo real com dados sintéticos e ferramentas inteiramente em memória.
// Não importa executores de produção quando --tools-json é fornecido.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { CASES, COMPANY, NOW, makeState, executeFixture, evaluateCase } from "./eval-whatsapp-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NO_LOG = { warn() {}, info() {}, error() {}, debug() {} };
const HARD_REQUEST_LIMIT = 120;
const HARD_USD_LIMIT = 5;
const DEFAULT_PRICES = { entrada: 500, saida: 2500, cacheLeitura: 50, cacheEscrita: 625 };

export function parseArgs(argv) {
  const args = {};
  const flags = new Set(["live", "dry-run", "schema-only", "list", "help"]);
  const values = new Set(["output", "cases", "code-root", "runtime-root", "tools-json", "model", "effort", "max-tokens", "max-requests", "max-usd"]);
  for (let i = 0; i < argv.length; i++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!match) throw new Error(`Argumento não reconhecido: ${argv[i]}`);
    const [, name, inline] = match;
    if (flags.has(name)) { if (inline !== undefined) throw new Error(`--${name} não recebe valor`); args[name] = true; }
    else if (values.has(name)) {
      const value = inline ?? argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`Falta valor para --${name}`);
      args[name] = value;
    } else throw new Error(`Opção não reconhecida: --${name}`);
  }
  for (const name of ["code-root", "runtime-root", "tools-json"]) if (args[name] && !isAbsolute(args[name])) throw new Error(`--${name} deve ser absoluto`);
  return args;
}

function validLimit(value, fallback, hard, name) {
  const n = value == null ? fallback : Number(value);
  if (!(n > 0) || n > hard || !Number.isFinite(n)) throw new Error(`${name} deve estar entre 0 e ${hard}`);
  return n;
}

function usageCost(usage, price) {
  const n = (v) => Math.max(0, Number(v) || 0);
  return (n(usage?.input_tokens) * price.entrada + n(usage?.output_tokens) * price.saida
    + n(usage?.cache_read_input_tokens) * price.cacheLeitura + n(usage?.cache_creation_input_tokens) * price.cacheEscrita) / 100_000_000;
}

/** Reserva conservadora antes da rede; sem retries. O limite é estimado, não substitui fatura. */
export function createBudgetClient(raw, { maxRequests = HARD_REQUEST_LIMIT, maxUsd = HARD_USD_LIMIT, priceFor = () => DEFAULT_PRICES } = {}) {
  const limitRequests = Math.floor(validLimit(maxRequests, HARD_REQUEST_LIMIT, HARD_REQUEST_LIMIT, "maxRequests"));
  const limitUsd = validLimit(maxUsd, HARD_USD_LIMIT, HARD_USD_LIMIT, "maxUsd");
  const ledger = { requests: 0, estimatedUsd: 0, reservedUsd: 0, maxRequests: limitRequests, maxUsd: limitUsd, requestsLog: [] };
  let budgetStopped = false;
  const client = { messages: { create: async (body) => {
    const price = priceFor(body.model);
    // Byte length bounds the tokenizer input conservatively; allowance covers provider tool formatting.
    const boundInputTokens = Buffer.byteLength(JSON.stringify(body), "utf8") + 4096;
    const reservation = (boundInputTokens * Math.max(price.entrada, price.cacheEscrita) + Number(body.max_tokens || 0) * price.saida) / 100_000_000;
    if (budgetStopped || ledger.requests >= limitRequests || ledger.estimatedUsd + ledger.reservedUsd + reservation > limitUsd) {
      budgetStopped = true;
      throw Object.assign(new Error("A avaliação atingiu o teto de chamadas ou a reserva do orçamento estimado."), { code: "EVAL_BUDGET_EXCEEDED" });
    }
    ledger.requests += 1;
    ledger.reservedUsd += reservation;
    const started = Date.now();
    const entry = { request: ledger.requests, model: body.model, reservationUsd: reservation, latencyMs: null, usage: null, estimatedUsd: null, status: null };
    ledger.requestsLog.push(entry);
    try {
      const response = await raw.messages.create(body, { timeout: 45000, maxRetries: 0 });
      entry.usage = response?.usage ? structuredClone(response.usage) : null;
      // Missing usage is charged at the full reservation, never silently treated as zero.
      entry.estimatedUsd = response?.usage ? usageCost(response.usage, price) : reservation;
      entry.status = "ok";
      ledger.estimatedUsd += entry.estimatedUsd;
      return response;
    } catch (error) {
      entry.status = "error";
      entry.httpStatus = Number(error?.status || 0) || null;
      // An uncertain failed request may have consumed tokens. Keep the reservation as spent.
      entry.estimatedUsd = reservation;
      ledger.estimatedUsd += reservation;
      throw error;
    } finally {
      ledger.reservedUsd = Math.max(0, ledger.reservedUsd - reservation);
      entry.latencyMs = Date.now() - started;
    }
  } } };
  return { client, ledger, stopped: () => budgetStopped || ledger.estimatedUsd >= limitUsd || ledger.requests >= limitRequests };
}

export function safeError(error) {
  return { name: ["AssistenteClientError", "APIError", "Error"].includes(error?.name) ? error.name : "Error",
    code: /^[A-Z][A-Z0-9_]{1,80}$/.test(String(error?.codigo || error?.code || "")) ? error.codigo || error.code : "EVAL_ERROR",
    status: Number(error?.status || 0) || null,
    diagnostic: error?.diagnostico ? { categoria: error.diagnostico.categoria || null, tipo: error.diagnostico.tipo || null } : null };
}

function priceTable(module) {
  return typeof module.precoDoModelo === "function" ? module.precoDoModelo : () => DEFAULT_PRICES;
}

/** /tmp trees can resolve the runtime SDK without changing application files or dependency trees. */
async function loadModules(codeRoot, runtimeRoot) {
  const requireRuntime = createRequire(resolve(runtimeRoot, "package.json"));
  const sdkPath = requireRuntime.resolve("@anthropic-ai/sdk");
  const sdkModule = await import(pathToFileURL(sdkPath).href);
  const Anthropic = sdkModule.default?.Anthropic || sdkModule.default || sdkModule.Anthropic;
  const clientPath = resolve(codeRoot, "src/application/assistente/AssistenteClient.js");
  let clientSource = await readFile(clientPath, "utf8");
  // Only module specifiers change. Client loop, prompt and config remain the selected revision.
  clientSource = clientSource.replace(/(from\s+)(["'])([^"']+)\2/g, (whole, prefix, quote, specifier) => {
    if (specifier === "@anthropic-ai/sdk") return `${prefix}${JSON.stringify(pathToFileURL(sdkPath).href)}`;
    if (specifier.startsWith(".")) return `${prefix}${JSON.stringify(pathToFileURL(resolve(dirname(clientPath), specifier)).href)}`;
    return whole;
  });
  const clientModule = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);
  const [promptModule, pricesModule] = await Promise.all([
    import(pathToFileURL(resolve(codeRoot, "src/application/assistente/promptDoAssistente.js")).href),
    import(pathToFileURL(resolve(codeRoot, "src/application/assistente/precosIa.js")).href),
  ]);
  return { Anthropic, AssistenteClient: clientModule.AssistenteClient, montarSystem: promptModule.montarSystem, priceFor: priceTable(pricesModule) };
}

export async function loadDefinitions(args, codeRoot) {
  if (args["tools-json"]) {
    const decoded = JSON.parse(await readFile(args["tools-json"], "utf8"));
    const definitions = Array.isArray(decoded) ? decoded : decoded.definicoes || decoded.tools || decoded.DEFINICOES;
    if (!Array.isArray(definitions) || definitions.some((d) => !d?.name || !d?.input_schema)) throw new Error("Arquivo de ferramentas inválido: forneça array de definições Anthropic.");
    return definitions;
  }
  // This import is needed only to obtain definitions locally; no executor is called by the harness.
  const module = await import(pathToFileURL(resolve(codeRoot, "src/application/assistente/ferramentas/index.js")).href);
  return module.definicoes();
}

export async function runConversationCase(scenario, { createAssistant, montarSystem, definitions, onTurn = async () => {} }) {
  const state = makeState(scenario);
  const history = structuredClone(scenario.history || []);
  const turns = [];
  const started = Date.now();
  for (const user of scenario.turns) {
    history.push({ role: "user", content: user });
    const toolOffset = state.calls.length;
    const deliveriesOffset = state.deliveries.length;
    const pendingBefore = state.pending?.codigo || null;
    const start = Date.now();
    let response = null;
    let error = null;
    try {
      response = await createAssistant().responder({
        system: montarSystem({ empresa: COMPANY, sessao: { ok: true, papel: "CLIENT_ADMIN", contatoNome: "Lia de Teste" }, pendencia: state.pending, janela: { aberta: true }, hoje: NOW }),
        messages: history, ferramentas: definitions,
        executar: (name, input) => executeFixture(state, name, input),
      });
    } catch (e) { error = safeError(e); }
    const text = response?.texto || "";
    const turn = { user, assistant: text, tools: structuredClone(state.calls.slice(toolOffset)),
      deliveries: structuredClone(state.deliveries.slice(deliveriesOffset)), pending: structuredClone(state.pending),
      stopReason: response?.stopReason || null, usage: response?.usage || null, iterations: response?.iteracoes || 0,
      latencyMs: Date.now() - start, error };
    turns.push(turn);
    if (text) history.push({ role: "assistant", content: text });
    // Production sends this declaration outside the model. Reproduce the visible transcript only.
    if (state.pending && state.pending.codigo !== pendingBefore) {
      turn.systemMessages = [state.pending.texto];
      history.push({ role: "assistant", content: state.pending.texto });
    }
    await onTurn({ scenario, state, turns });
    if (error) break;
  }
  return { id: scenario.id, objective: scenario.objective, plannedTurns: scenario.turns.length, turns,
    latencyMs: Date.now() - started, state, evaluation: evaluateCase(scenario, state, turns) };
}

const HELP = `Avaliação do WhatsApp com modelo real e ferramentas sintéticas.
Uso: node scripts/eval-whatsapp-conversacao.mjs --live --output /tmp/resultado.json [opções]
  --code-root /raiz/api       Pasta contendo src/ (padrão: pasta api deste script)
  --runtime-root /app         Local de package.json/node_modules que fornece o SDK
  --tools-json /tmp/tools.json Definições já exportadas; evita importar ferramentas e Prisma
  --cases id1,id2             Filtra cenários; --list mostra os ids
  --schema-only              Uma chamada curta com catálogo completo para validar compatibilidade
  --model nome --effort nível --max-tokens número
  --max-requests número       Até 120; inclui todas as rodadas do modelo
  --max-usd valor             Até US$ 5 estimados; reserva conservadora antes de cada chamada
  --dry-run                  Exporta plano sintético, sem SDK, chave, banco nem chamadas
Não envia WhatsApp, não consulta Receita e não executa atos fiscais. Não mede o worker de produção.
Os checks automáticos não substituem revisão independente da naturalidade das transcrições.`;

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log(HELP); return 0; }
  if (args.list) { console.log(CASES.map((c) => `${c.id}\t${c.turns.length}\t${c.objective}`).join("\n")); return 0; }
  const requested = args.cases?.split(",").filter(Boolean);
  if (requested?.some((id) => !CASES.some((c) => c.id === id))) throw new Error("--cases contém um id desconhecido. Use --list.");
  const selected = requested ? CASES.filter((c) => requested.includes(c.id)) : CASES;
  if (!args["dry-run"] && !args.live) throw new Error("Rede exige --live explícito. Use --dry-run para inspecionar o plano sem chamadas.");
  if (!args.output) throw new Error("Informe --output para guardar a avaliação e o orçamento.");
  if (args.live && args["dry-run"]) throw new Error("Escolha somente --live ou --dry-run.");
  const maxRequests = validLimit(args["max-requests"], HARD_REQUEST_LIMIT, HARD_REQUEST_LIMIT, "--max-requests");
  const maxUsd = validLimit(args["max-usd"], HARD_USD_LIMIT, HARD_USD_LIMIT, "--max-usd");
  const output = resolve(args.output);
  await mkdir(dirname(output), { recursive: true });
  const report = { version: 1, mode: args["dry-run"] ? "dry-run" : args["schema-only"] ? "schema-only" : "live-model-synthetic-tools",
    createdAt: new Date().toISOString(), fixtureDate: NOW.toISOString(), safety: { syntheticData: true, productionToolsExecuted: false, fiscalActsExecuted: false, whatsappSent: false },
    limits: { maxRequests, maxUsd }, model: args.model || null, results: [], budget: null,
    limitations: ["Ferramentas inteiramente simuladas; não comprova integrações externas, permissões do servidor, worker ou confirmação fiscal.", "Aprovação automática avalia estado e invariantes; naturalidade exige revisão independente da transcrição."] };
  const save = () => writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (args["dry-run"]) {
    report.plan = selected.map(({ id, objective, turns }) => ({ id, objective, turns }));
    report.plannedTurns = selected.reduce((sum, c) => sum + c.turns.length, 0);
    await save(); console.log(JSON.stringify({ mode: report.mode, cases: selected.length, turns: report.plannedTurns, output })); return 0;
  }
  const codeRoot = args["code-root"] || resolve(HERE, "..");
  const runtimeRoot = args["runtime-root"] || codeRoot;
  const modules = await loadModules(codeRoot, runtimeRoot);
  const definitions = await loadDefinitions(args, codeRoot);
  const raw = new modules.Anthropic({ timeout: 45000, maxRetries: 0 });
  const budget = createBudgetClient(raw, { maxRequests, maxUsd, priceFor: modules.priceFor });
  report.budget = budget.ledger;
  report.definitionNames = definitions.map((d) => d.name);
  const options = { client: budget.client, log: NO_LOG,
    ...(args.model ? { modelo: args.model } : {}), ...(args.effort ? { esforco: args.effort === "none" ? null : args.effort } : {}),
    ...(args["max-tokens"] ? { maxTokens: Math.floor(validLimit(args["max-tokens"], 2048, 8192, "--max-tokens")) } : {}) };
  const createAssistant = () => new modules.AssistenteClient(options);
  report.model = createAssistant().modelo;
  report.effort = createAssistant().esforco || null;
  report.maxTokens = createAssistant().maxTokens;
  await save();
  if (args["schema-only"]) {
    try {
      const assistant = new modules.AssistenteClient({ ...options, maxTokens: 128, maxIteracoes: 1 });
      const response = await assistant.responder({ system: modules.montarSystem({ empresa: COMPANY, sessao: { papel: "CLIENT_ADMIN", contatoNome: "Lia de Teste" }, hoje: NOW }), messages: [{ role: "user", content: "oi" }], ferramentas: definitions, executar: async () => ({ ok: false, mensagem: "Verificação de schema: funções não são executadas." }) });
      report.schema = { accepted: budget.ledger.requestsLog.some((r) => r.status === "ok"), stopReason: response.stopReason, assistant: response.texto, usage: response.usage };
    } catch (e) { report.schema = { accepted: false, error: safeError(e) }; }
    await save(); console.log(JSON.stringify({ mode: report.mode, ...report.schema, requests: budget.ledger.requests, estimatedUsd: budget.ledger.estimatedUsd, output })); return report.schema.accepted ? 0 : 2;
  }
  try {
    for (const scenario of selected) {
      if (budget.stopped()) { report.stopped = "budget"; break; }
      const result = await runConversationCase(scenario, { createAssistant, montarSystem: modules.montarSystem, definitions,
        onTurn: async ({ state, turns }) => { report.inProgress = { id: scenario.id, turns, state }; await save(); } });
      report.results.push(result); delete report.inProgress;
      await save();
      console.log(JSON.stringify({ case: result.id, turns: result.turns.length, passed: result.evaluation.passed, failedChecks: result.evaluation.checks.filter((c) => !c.passed).map((c) => c.id), requests: budget.ledger.requests, estimatedUsd: budget.ledger.estimatedUsd }));
      // Repeating an API/configuration failure across all cases burns budget without new evidence.
      if (result.turns.some((t) => t.error)) { report.stopped = budget.stopped() ? "budget" : "model-error"; break; }
    }
  } finally {
    report.summary = { plannedCases: selected.length, completedCases: report.results.length,
      passedCases: report.results.filter((r) => r.evaluation.passed).length, turns: report.results.reduce((sum, r) => sum + r.turns.length, 0),
      requests: budget.ledger.requests, estimatedUsd: budget.ledger.estimatedUsd, qualitativeReviewRequired: true };
    await save();
  }
  console.log(JSON.stringify({ summary: report.summary, stopped: report.stopped || null, output }));
  return report.results.length === selected.length && report.results.every((r) => r.evaluation.passed) ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    // Never dump SDK errors, request bodies, environment variables or stack traces containing data URLs.
    console.error(JSON.stringify({ error: safeError(error), message: error?.name === "Error" && !process.argv.includes("--live") ? error.message : "Falha na avaliação; consulte o JSON de resultado, quando disponível." }));
    process.exitCode = 2;
  });
}
