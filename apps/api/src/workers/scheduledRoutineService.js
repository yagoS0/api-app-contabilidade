import crypto from "node:crypto";
import { prisma } from "../infrastructure/db/prisma.js";
import { describeSchedule, previousCompetencia } from "./routineSchedule.js";

const PREFIX = "fiscal_schedule:";
const LEASE_MS = 5 * 60000;
const MAX_ATTEMPTS = 1;

const jsonValue = (value) => JSON.parse(JSON.stringify(value));

export async function claimScheduledRun({ routine, config, now = new Date(), db = prisma }) {
  const { dueAt } = describeSchedule(config, now);
  if (!dueAt) return null;
  const key = `${PREFIX}${routine}:${dueAt}`;
  const existing = await db.appSetting.findUnique({ where: { key } });
  // A reserved slot may already have incurred provider costs, even after a crash.
  // Do not automatically repeat failed, partial or expired executions.
  if (existing) return null;
  const value = {
    routine, scheduledAt: dueAt, status: "RUNNING", owner: crypto.randomUUID(),
    attempts: 1, startedAt: now.toISOString(),
    leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
    competencia: previousCompetencia(new Date(dueAt)),
  };
  try { await db.appSetting.create({ data: { key, value } }); }
  catch (err) { if (err?.code === "P2002") return null; throw err; }
  return { key, value };
}

export async function finishScheduledRun(claim, result, error, { db = prisma, now = new Date() } = {}) {
  const current = await db.appSetting.findUnique({ where: { key: claim.key } });
  if (current?.value?.owner !== claim.value.owner) return false;
  const failed = Boolean(error || result?.skipped || result?.failed || result?.falhas
    || result?.naoConferiveis || result?.extratoErro || result?.parcelasErro || result?.skippedByProcuration || result?.avisosPendentes
    || (Array.isArray(result?.errors) ? result.errors.length : Number(result?.errors || 0)));
  // A execução técnica pode terminar sem responder a situação fiscal. Isso exige conferência,
  // não outra rodada paga automática de uma resposta já recebida.
  const ressalvasPagamento = claim.value.routine === "pagamento" && Boolean(
    result?.indeterminados || result?.divergentes || result?.naoAplicavel || result?.semDoc
    || result?.cobertura === "PARCIAL" || result?.qualidadeConsulta === "PARCIAL");
  const value = jsonValue({ ...current.value, owner: null, leaseUntil: null,
    status: failed ? "FAILED" : "SUCCEEDED", finishedAt: now.toISOString(),
    ...(claim.value.routine === "pagamento" ? { qualidadeConsulta: failed || ressalvasPagamento ? "PARCIAL" : "COMPLETA" } : {}),
    retryAt: null,
    error: error ? String(error.code || error.message || error) : null,
    result: result ?? null,
  });
  const updated = await db.appSetting.updateMany({
    where: { key: claim.key, value: { equals: current.value } }, data: { value },
  });
  return updated.count > 0;
}

export async function runScheduledRoutine(routine, config, run, { db = prisma, now = new Date() } = {}) {
  const claim = await claimScheduledRun({ routine, config, now, db });
  if (!claim) return null;
  let active = true;
  let leaseExpiry = new Date(claim.value.leaseUntil).getTime();
  let pending = Promise.resolve();
  const assertActive = () => { if (!active || leaseExpiry <= Date.now()) throw Object.assign(new Error("Execução interrompida. Confira o resultado antes de consultar novamente."), { code: "SCHEDULE_LEASE_LOST" }); };
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      if (!active || leaseExpiry <= Date.now()) { active = false; return; }
      const current = await db.appSetting.findUnique({ where: { key: claim.key } });
      if (current?.value?.owner !== claim.value.owner) { active = false; return; }
      const nextExpiry = Date.now() + LEASE_MS;
      const r = await db.appSetting.updateMany({
        where: { key: claim.key, value: { equals: current.value } },
        data: { value: { ...current.value, leaseUntil: new Date(nextExpiry).toISOString() } },
      });
      if (!r.count) active = false;
      else leaseExpiry = nextExpiry;
    }).catch(() => { active = false; });
  }, 60000);
  timer.unref?.();
  try {
    const result = await run({ routines: [routine], competencia: claim.value.competencia,
      scheduledAt: claim.value.scheduledAt, assertActive });
    clearInterval(timer);
    await pending;
    assertActive();
    await finishScheduledRun(claim, result, null, { db });
    return result;
  } catch (error) {
    clearInterval(timer);
    await pending;
    await finishScheduledRun(claim, null, error, { db });
    throw error;
  } finally { active = false; clearInterval(timer); }
}

export async function recordWorkerHeartbeat(worker) {
  const key = `fiscal_worker:${worker}`;
  const value = { worker, observedAt: new Date().toISOString() };
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function getRoutineExecutionStatus(settings, now = new Date()) {
  const workers = {
    das: "SERPRO_PGDASD_WORKER_ENABLED", extrato: "SERPRO_PGDASD_WORKER_ENABLED",
    presumido: "SERPRO_PGDASD_WORKER_ENABLED", parcelamento: "SERPRO_PGDASD_WORKER_ENABLED",
    inss: "SERPRO_DCTFWEB_WORKER_ENABLED", pagamento: "SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED",
    conferencia: "CONFERENCIA_ADN_WORKER_ENABLED",
  };
  return Promise.all(Object.entries(settings.rotinas || {}).map(async ([routine, config]) => {
    const workerFlag = workers[routine];
    const [latest, heartbeat] = await Promise.all([
      prisma.appSetting.findFirst({ where: { key: { startsWith: `${PREFIX}${routine}:` } }, orderBy: { key: "desc" } }),
      prisma.appSetting.findUnique({ where: { key: `fiscal_worker:${workerFlag}` } }),
    ]);
    const schedule = describeSchedule(config, now);
    const integrationEnabled = routine !== "parcelamento" || process.env.INTEGRACAO_SERPRO_PARCELAMENTO === "1";
    const enabled = integrationEnabled && process.env[workerFlag] === "1" && config.enabled === true
      && (routine === "conferencia" || settings.enabled);
    const heartbeatAt = heartbeat?.value?.observedAt || null;
    const alive = heartbeatAt && now - new Date(heartbeatAt) < 180000;
    const retryExhausted = latest?.value?.status === "FAILED" && Number(latest.value.attempts) >= MAX_ATTEMPTS;
    const overdue = enabled && schedule.previousAt
      && (!latest || latest.value.scheduledAt < schedule.previousAt);
    const interrupted = latest?.value?.status === "RUNNING" && new Date(latest.value.leaseUntil) <= now;
    const nextEffectiveAt = schedule.nextAt;
    return { routine, enabled, integrationEnabled, workerEnabled: process.env[workerFlag] === "1",
      heartbeatAt, alive: Boolean(alive), overdue: Boolean(overdue), interrupted, retryExhausted, maxAttempts: MAX_ATTEMPTS,
      ...schedule, nextEffectiveAt, lastRun: latest ? { ...latest.value, retryAt: null } : null };
  }));
}
