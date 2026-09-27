import { createHash } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";

export const TASK_STALE_MS = 120000;
const clean = (value) => JSON.parse(JSON.stringify(value ?? null));
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function listTaskRecords(model, activeStatus, scope = {}, options = {}) {
  const [active, recent] = await Promise.all([
    model.findMany({ ...options, where: { ...scope, status: activeStatus }, orderBy: { createdAt: "desc" } }),
    model.findMany({ ...options, where: { ...scope, status: { not: activeStatus }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  return [...new Map([...active, ...recent].map(task => [task.id, task])).values()];
}
export function taskSummary(task) {
  return { jobId: task.id, tipo: task.kind, status: task.status, total: task.total,
    processadas: task.completed, companyIds: task.companyIds, descricao: task.description,
    createdAt: task.createdAt, updatedAt: task.updatedAt, erroMensagem: task.error,
    origem: "manual", competencia: task.competencia, progress: task.progress };
}

// Executa SOMENTE o trabalho aceito nesta requisição. Não drena filas antigas,
// não consulta provedores ao ler progresso e não repete resultado desconhecido.
export function createManualTaskService({ db = prisma, schedule = (fn) => setImmediate(fn) } = {}) {
  async function expire(where = {}) {
    await db.manualTask.updateMany({ where: { ...where, status: "running", updatedAt: { lt: new Date(Date.now() - TASK_STALE_MS) } },
      data: { status: "interrupted", activeKey: null, finishedAt: new Date(),
        error: "O processamento foi interrompido. Confira os resultados antes de iniciar outra tentativa." } });
  }
  async function start({ ownerId, requestKey, kind, companyIds = [], total = 0, description = null, competencia = null, fingerprint }, run) {
    if (!ownerId || !/^[a-zA-Z0-9_-]{16,100}$/.test(String(requestKey || ""))) {
      const err = new Error("Identificador da tarefa inválido. Atualize a página antes de tentar novamente."); err.status = 400; throw err;
    }
    const previous = await db.manualTask.findUnique({ where: { ownerId_requestKey: { ownerId, requestKey } } });
    if (previous) return { ...previous, newlyStarted: false };
    const activeKey = digest([kind, [...companyIds].sort(), fingerprint ?? requestKey]);
    await expire({ activeKey });
    let task;
    try {
      task = await db.manualTask.create({ data: { ownerId, requestKey, activeKey, kind, companyIds,
        total, description, competencia, status: "running" } });
    } catch (err) {
      if (err.code !== "P2002") throw err;
      const same = await db.manualTask.findUnique({ where: { ownerId_requestKey: { ownerId, requestKey } } });
      if (same) return { ...same, newlyStarted: false };
      const conflict = new Error("Esta operação já está em execução. Acompanhe a tarefa antes de iniciar outra."); conflict.status = 409; throw conflict;
    }
    schedule(async () => {
      let heartbeat;
      const update = async (data) => {
        const out = await db.manualTask.updateMany({ where: { id: task.id, status: "running" }, data });
        if (out.count !== 1) throw new Error("A tarefa foi interrompida. Confira o resultado antes de repetir.");
      };
      try {
        await update({ updatedAt: new Date() });
        heartbeat = setInterval(() => { update({ updatedAt: new Date() }).catch(() => {}); }, 20000);
        heartbeat.unref?.();
        const progress = async (completed, detail = null) => update({ completed, ...(detail ? { progress: clean(detail) } : {}) });
        const { statusCode = 200, body = null } = await run(progress);
        const attention = body?.ok === false || body?.sent === false && body?.envio?.naoSeAplica !== true
          || body?.errors?.length > 0 || body?.recusadas > 0 || body?.ignoradas > 0
          || body?.processando === true || body?.errorCount > 0 || body?.failed > 0
          || body?.results?.some(r => r.ok === false || r.error || ["error", "erro", "failed"].includes(r.status))
          || body?.resultados?.some(r => !r.ok || r.tom === "pendente");
        await update({ status: statusCode >= 400 ? "error" : attention ? "partial" : "done",
          result: clean(body), responseStatus: statusCode, completed: total, activeKey: null, finishedAt: new Date() });
      } catch (err) {
        // Uma falha de persistência depois do transporte não autoriza repetir o transporte.
        await db.manualTask.updateMany({ where: { id: task.id, status: "running" }, data: {
          status: "interrupted", activeKey: null, finishedAt: new Date(),
          error: "Não foi possível confirmar a conclusão. Confira os resultados antes de repetir a operação.",
        } }).catch(() => {});
      } finally { clearInterval(heartbeat); }
    });
    return { ...task, newlyStarted: true };
  }
  return { start, expire };
}

export const manualTasks = createManualTaskService();

// O Express pode restaurar params ao encerrar a resposta de aceite.
// O executor usa o contexto aceito, sem depender da requisição já encerrada.
export function snapshotTaskRequest(req) {
  const snapshot = Object.create(req);
  for (const key of ["params", "body", "query", "auth", "headers"]) {
    Object.defineProperty(snapshot, key, { value: clean(req[key]), enumerable: true });
  }
  return snapshot;
}

// Adapta os handlers existentes preservando status HTTP, validações e resultados.
export async function captureTaskResponse(run, progress) {
  let statusCode = 200, body, answered = false;
  const response = { status(code) { statusCode = code; return response; },
    json(value) { body = value; answered = true; return response; } };
  await run(response, progress);
  if (!answered) throw new Error("task_without_result");
  return { statusCode, body };
}

export async function respondWithTask(req, res, descriptor, run) {
  const execute = async (response, progress) => {
    try { return await run(response, progress); }
    catch (err) {
      const known = ["NO_COMPANIES", "NONE_CLOSED"].includes(err?.code);
      if (!known) throw err;
      return response.status(400).json({ ok: false, error: err.code, message: err.message });
    }
  };
  if (req.get?.("Prefer") !== "respond-async") return execute(res, async () => {});
  try {
    const task = await manualTasks.start({ ...descriptor, ownerId: req.auth?.user?.id,
      requestKey: req.get("Idempotency-Key") }, (progress) => captureTaskResponse(execute, progress));
    if (!task.newlyStarted) await descriptor.onDiscard?.();
    return res.status(202).json({ ok: true, taskId: task.id });
  } catch (err) { await descriptor.onDiscard?.(); return res.status(err.status || 500).json({ ok: false, error: "task_start_failed", message: err.message }); }
}

// Use após os middlewares de autorização e acesso da rota.
export function backgroundRoute(kind, handler, description = null) {
  return (req, res) => {
    const acceptedRequest = snapshotTaskRequest(req);
    return respondWithTask(req, res, { kind, description,
    companyIds: req.taskCompanyIds || (req.params.companyId ? [String(req.params.companyId)] : []),
    competencia: req.params.competencia || req.body?.competencia || req.query?.competencia || null,
    fingerprint: [req.route?.path, description, req.params, req.body, req.query],
    }, response => handler(acceptedRequest, response));
  };
}
