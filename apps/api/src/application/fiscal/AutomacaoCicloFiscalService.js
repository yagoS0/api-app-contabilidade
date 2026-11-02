import { prisma } from '../../infrastructure/db/prisma.js';

// Escopo global desta instalação, como a agenda fiscal existente (sem firmId).
export const CICLO_FISCAL_KEY = 'automacao_ciclo_fiscal';
export class AutomacaoCicloFiscalError extends Error {
  constructor(code, message, status = 409) {
    super(message); this.code = code; this.status = status;
  }
}
const unavailable = () => new AutomacaoCicloFiscalError('CICLO_FISCAL_INDISPONIVEL', 'Não foi possível conferir a pausa do ciclo fiscal. Nenhuma nova automação foi autorizada.', 503);
export async function bloquearCicloFiscal(db) {
  await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(73517002)`;
}
export async function lerAutomacaoCicloFiscal(db = prisma) {
  try {
    const row = await db.appSetting.findUnique({ where: { key: CICLO_FISCAL_KEY } });
    // Compatibilidade explícita: não habilita rotina, empresa, agenda ou worker.
    // Instalações sem registro conservam os gates anteriores; GET nunca semeia dados.
    if (row === null) return { paused: false, version: 0, legacy: true, reason: null, actor: null, changedAt: null, resumedAt: null };
    const v = row?.value;
    if (!v || typeof v.paused !== 'boolean' || !Number.isSafeInteger(v.version) || v.version < 1
      || typeof v.reason !== 'string' || !v.reason.trim() || !v.actor?.id
      || !Number.isFinite(Date.parse(v.changedAt))
      || (v.resumedAt !== null && !Number.isFinite(Date.parse(v.resumedAt)))) throw unavailable();
    return { ...v, legacy: false };
  } catch { throw unavailable(); }
}
export async function conferirAutomacaoCicloFiscal({ db = prisma, version, scheduledAt } = {}) {
  const policy = await lerAutomacaoCicloFiscal(db);
  if (policy.paused) throw new AutomacaoCicloFiscalError('CICLO_FISCAL_PAUSADO', 'As automações do ciclo fiscal estão pausadas.');
  if (version !== undefined && policy.version !== version) throw new AutomacaoCicloFiscalError('CICLO_FISCAL_REVISAO_ALTERADA', 'A pausa do ciclo fiscal mudou. Esta execução não será retomada automaticamente.');
  if (scheduledAt && policy.resumedAt && Date.parse(scheduledAt) <= Date.parse(policy.resumedAt)) {
    throw new AutomacaoCicloFiscalError('CICLO_FISCAL_HORARIO_ANTERIOR', 'Horário anterior à retomada; confira manualmente a pendência.');
  }
  return policy;
}
export async function alterarAutomacaoCicloFiscal({ paused, version, reason, actor }, db = prisma) {
  if (!actor?.id || !['admin', 'contador'].includes(String(actor.role).toLowerCase())) throw new AutomacaoCicloFiscalError('forbidden_admin_or_contador_only', 'Somente administrador ou contador pode alterar a pausa.', 403);
  if (typeof paused !== 'boolean' || !Number.isSafeInteger(version) || version < 0 || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) throw new AutomacaoCicloFiscalError('CICLO_FISCAL_DADOS_INVALIDOS', 'Informe motivo e versão válidos.', 400);
  return db.$transaction(async tx => {
    await bloquearCicloFiscal(tx);
    const before = await lerAutomacaoCicloFiscal(tx);
    // Replay exato é idempotente; nunca desfaz uma transição posterior.
    if (before.version === version + 1 && before.paused === paused && before.reason === reason.trim() && before.actor?.id === actor.id) return before;
    if (before.version !== version) throw new AutomacaoCicloFiscalError('CICLO_FISCAL_CONFLITO', 'A configuração mudou. Atualize antes de confirmar.');
    if (before.paused === paused) return before;
    const changedAt = new Date().toISOString();
    const after = { paused, version: version + 1, reason: reason.trim(), actor: { id: actor.id, name: actor.name || null }, changedAt, resumedAt: paused ? before.resumedAt : changedAt };
    await tx.appSetting.upsert({ where: { key: CICLO_FISCAL_KEY }, create: { key: CICLO_FISCAL_KEY, value: after }, update: { value: after } });
    await tx.appSetting.create({ data: { key: `${CICLO_FISCAL_KEY}:audit:${after.version}`, value: { before, after } } });
    return { ...after, legacy: false };
  });
}
