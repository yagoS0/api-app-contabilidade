import crypto from "node:crypto";
import { prisma } from "../infrastructure/db/prisma.js";
import { describeSchedule, previousCompetencia } from "./routineSchedule.js";

const PREFIX = "fiscal_schedule:";
const LEASE_MS = 5 * 60000;
const RETRY_MS = 15 * 60000;
const MAX_ATTEMPTS = 3;

const jsonValue = (value) => JSON.parse(JSON.stringify(value));

function retomadaDosPagamentos(old) {
  if (old?.status === "RUNNING") return old.retomadaPagamento || null;
  if (old?.status !== "FAILED") return null;
  const results = old.result?.results;
  if (!Array.isArray(results)) return old.retomadaPagamento || null;
  const erros = results.filter(r => r.status === "error");
  // Sem identificação completa da falha não inventamos uma cobertura/sublista.
  if (!erros.length || erros.some(r => !r.guideId && !r.parcelaId)) return null;
  return {
    guideIds: [...new Set(erros.map(r => r.guideId).filter(Boolean))],
    parcelaIds: [...new Set(erros.map(r => r.parcelaId).filter(Boolean))],
    concluidos: results.filter(r => r.status !== "error"),
  };
}

export async function claimScheduledRun({ routine, config, now = new Date(), db = prisma }) {
  const { dueAt } = describeSchedule(config, now);
  if (!dueAt) return null;
  const key = `${PREFIX}${routine}:${dueAt}`;
  const existing = await db.appSetting.findUnique({ where: { key } });
  const old = existing?.value;
  if (old?.status === "SUCCEEDED" || Number(old?.attempts || 0) >= MAX_ATTEMPTS) return null;
  if (old?.status === "RUNNING" && new Date(old.leaseUntil) > now) return null;
  if (old?.retryAt && new Date(old.retryAt) > now) return null;
  const retomadaPagamento = routine === "pagamento" ? retomadaDosPagamentos(old) : null;
  const value = {
    routine, scheduledAt: dueAt, status: "RUNNING", owner: crypto.randomUUID(),
    attempts: Number(old?.attempts || 0) + 1, startedAt: now.toISOString(),
    leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
    competencia: previousCompetencia(new Date(dueAt)),
    ...(retomadaPagamento ? { retomadaPagamento } : {}),
  };
  if (existing) {
    const changed = await db.appSetting.updateMany({
      where: { key, value: { equals: old } }, data: { value },
    });
    if (!changed.count) return null;
  } else {
    try { await db.appSetting.create({ data: { key, value } }); }
    catch (err) { if (err?.code === "P2002") return null; throw err; }
  }
  return { key, value };
}

export async function finishScheduledRun(claim, result, error, { db = prisma, now = new Date() } = {}) {
  const current = await db.appSetting.findUnique({ where: { key: claim.key } });
  if (current?.value?.owner !== claim.value.owner) return false;
  const failed = Boolean(error || result?.skipped || result?.failed || result?.falhas
    || result?.naoConferiveis || result?.extratoErro || result?.parcelasErro || result?.skippedByProcuration
    || (Array.isArray(result?.errors) ? result.errors.length : Number(result?.errors || 0)));
  // A execução técnica pode terminar sem responder a situação fiscal. Isso exige conferência,
  // não outra rodada paga automática de uma resposta já recebida.
  const ressalvasPagamento = claim.value.routine === "pagamento" && Boolean(
    result?.indeterminados || result?.divergentes || result?.naoAplicavel || result?.semDoc
    || result?.cobertura === "PARCIAL" || result?.qualidadeConsulta === "PARCIAL");
  const value = jsonValue({ ...current.value, owner: null, leaseUntil: null,
    status: failed ? "FAILED" : "SUCCEEDED", finishedAt: now.toISOString(),
    ...(claim.value.routine === "pagamento" ? { qualidadeConsulta: failed || ressalvasPagamento ? "PARCIAL" : "COMPLETA" } : {}),
    retryAt: failed ? new Date(now.getTime() + RETRY_MS).toISOString() : null,
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
  const assertActive = () => { if (!active || leaseExpiry <= Date.now()) throw Object.assign(new Error("Execução perdeu a reserva; será retomada."), { code: "SCHEDULE_LEASE_LOST" }); };
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
      scheduledAt: claim.value.scheduledAt, assertActive,
      ...(claim.value.retomadaPagamento ? { retomadaPagamento: claim.value.retomadaPagamento } : {}) });
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
    const enabled = integrationEnabled && process.env[workerFlag] === "1" && config.enabled !== false
      && (routine === "conferencia" || settings.enabled);
    const heartbeatAt = heartbeat?.value?.observedAt || null;
    const alive = heartbeatAt && now - new Date(heartbeatAt) < 180000;
    const retryExhausted = latest?.value?.status === "FAILED" && Number(latest.value.attempts) >= MAX_ATTEMPTS;
    const overdue = enabled && schedule.previousAt
      && (!latest || latest.value.scheduledAt < schedule.previousAt);
    const retryAt = !retryExhausted && latest?.value?.status === "FAILED" ? latest.value.retryAt : null;
    const nextEffectiveAt = enabled && schedule.dueAt === latest?.value?.scheduledAt && retryAt && retryAt < schedule.nextAt ? retryAt : schedule.nextAt;
    return { routine, enabled, integrationEnabled, workerEnabled: process.env[workerFlag] === "1",
      heartbeatAt, alive: Boolean(alive), overdue: Boolean(overdue), retryExhausted, maxAttempts: MAX_ATTEMPTS,
      ...schedule, nextEffectiveAt, lastRun: latest?.value || null };
  }));
}
