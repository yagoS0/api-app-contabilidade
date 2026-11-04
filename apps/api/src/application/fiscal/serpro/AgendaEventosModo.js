import { createHash } from 'node:crypto';
export const CAPACIDADE_EVENTOS = Object.freeze({ contractVersion: 1, reminders: true, paymentD2: true, capture: false });
export const chaveModoEventos = id => `agenda_eventos_modo:v1:${id}`;
const hash = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
const fail = () => { throw Object.assign(new Error('Confira a adoção da agenda relativa.'), { code: 'EVENT_MODE_INVALID', status: 422 }); };
export function validarModoEventos(value) {
  if (!['LEGADO', 'RELATIVO_V1'].includes(value)) fail();
  return value;
}
export async function lerModoEventos(db, companyId) {
  const row = await db.appSetting.findUnique({ where: { key: chaveModoEventos(companyId) } });
  const v = row?.value;
  if (v && (v.schemaVersion !== 1 || !Number.isSafeInteger(v.version) || v.version < 1
    || !['LEGADO', 'RELATIVO_V1'].includes(v.executionMode) || typeof v.updatedBy !== 'string'
    || !Number.isFinite(Date.parse(v.updatedAt)) || Object.keys(v).some(k => !['schemaVersion','version','executionMode','updatedAt','updatedBy'].includes(k)))) fail();
  return { executionMode: v?.executionMode || 'LEGADO', modeRevision: hash(v), modeConfigured: Boolean(row),
    modeVersion: v?.version || 0, relativeConsumerReady: true, capabilities: CAPACIDADE_EVENTOS };
}
// Owning transaction supplies ACL, company lock, composite revision, replay and audit.
export async function gravarModoEventosNoTx(tx, companyId, userId, mode, expected) {
  validarModoEventos(mode);
  const current = await lerModoEventos(tx, companyId);
  if (current.modeRevision !== expected) throw Object.assign(new Error('A adoção mudou; recarregue.'), { code: 'AUTOMATION_CHANGED', status: 409 });
  if (current.executionMode === mode) return;
  if (current.modeVersion >= Number.MAX_SAFE_INTEGER) fail();
  const key = chaveModoEventos(companyId), prior = await tx.appSetting.findUnique({ where: { key } });
  const value = { schemaVersion: 1, version: current.modeVersion + 1, executionMode: mode, updatedAt: new Date().toISOString(), updatedBy: String(userId) };
  if (!prior) await tx.appSetting.create({ data: { key, value } });
  else {
    const changed = await tx.appSetting.updateMany({ where: { key, value: { equals: prior.value } }, data: { value } });
    if (changed.count !== 1) throw Object.assign(new Error('A adoção mudou; recarregue.'), { code: 'AUTOMATION_CHANGED', status: 409 });
  }
}
