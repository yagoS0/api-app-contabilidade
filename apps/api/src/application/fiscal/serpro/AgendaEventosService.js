import { CAPACIDADE_EVENTOS, lerModoEventos, validarModoEventos, gravarModoEventosNoTx } from './AgendaEventosModo.js';
import { createHash, randomUUID } from 'node:crypto';
import { AGENDA_TRIBUTOS, aplicarPatchAgenda, validarParametrosAgenda, validarPoliticaAgenda, resolverAgendaTributo } from './AgendaEventosPolicy.js';

const GLOBAL = 'agenda_eventos_global:v1';
const companyKey = id => `agenda_eventos_empresa:v1:${id}`;
const error = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const plain = v => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const revision = row => hash(row?.value ?? null);
const envelopeKeys = ['schemaVersion', 'version', 'parameters', 'updatedAt', 'updatedBy'];
function decode(row) {
  if (!row) return { schemaVersion: 1, version: 0, parameters: { schemaVersion: 1 }, updatedAt: null, updatedBy: null };
  const v = row.value;
  if (!plain(v) || v.schemaVersion !== 1 || !Number.isSafeInteger(v.version) || v.version < 1
    || Object.keys(v).some(k => !envelopeKeys.includes(k)) || typeof v.updatedBy !== 'string' || !v.updatedBy
    || typeof v.updatedAt !== 'string' || !Number.isFinite(Date.parse(v.updatedAt))) {
    throw error('EVENT_POLICY_INVALID', 'A configuração salva precisa ser conferida.');
  }
  validarPoliticaAgenda(v.parameters);
  return v;
}
export function validarPatchAgendaEmpresa(input) {
  if (!plain(input) || Object.keys(input).some(k => !['patch','executionMode'].includes(k)) || !Object.keys(input).length) throw error('INVALID_EVENT_POLICY', 'Informe somente o patch de parâmetros.', 422);
  if (Object.hasOwn(input, 'executionMode')) validarModoEventos(input.executionMode);
  validarParametrosAgenda(Object.hasOwn(input, 'patch') ? input.patch : {}, { patch: true });
  return canonical(input.patch || {});
}
export function validarPedidoAgendaGlobal(input) {
  if (!plain(input) || Object.keys(input).some(k => !['agendaEventos', 'requestId'].includes(k))
    || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId || '') || !plain(input.agendaEventos)
    || Object.keys(input.agendaEventos).some(k => !['expectedRevision', 'patch'].includes(k))
    || !/^[a-f0-9]{64}$/.test(input.agendaEventos.expectedRevision || '')) {
    throw error('INVALID_EVENT_POLICY', 'Salve os parâmetros de eventos separadamente das seleções e horários legados.', 422);
  }
  validarParametrosAgenda(input.agendaEventos.patch, { patch: true });
}
function publicPolicy(row) {
  const v = decode(row);
  return { schemaVersion: 1, revision: revision(row), version: v.version, configured: Boolean(row),
    timezone: 'America/Sao_Paulo', defaults: canonical(v.parameters.defaults || {}),
    tributos: canonical(v.parameters.tributos || {}), updatedAt: v.updatedAt, updatedBy: v.updatedBy,
    prepared: true, executionMode: 'LEGADO', relativeConsumerReady: true, capabilities: CAPACIDADE_EVENTOS };
}
export async function lerAgendaEventosGlobal(db) {
  return publicPolicy(await db.appSetting.findUnique({ where: { key: GLOBAL } }));
}
export async function lerAgendaEventosEmpresa(db, companyId) {
  if (typeof companyId !== 'string' || !companyId.trim()) throw error('INVALID_COMPANY', 'Empresa obrigatória.', 422);
  const global = await db.appSetting.findUnique({ where: { key: GLOBAL } });
  const local = await db.appSetting.findUnique({ where: { key: companyKey(companyId) } });
  const g = decode(global), c = decode(local);
  const mode = await lerModoEventos(db, companyId);
  const resolved = AGENDA_TRIBUTOS.map(tributo => resolverAgendaTributo(g.parameters, c.parameters, tributo));
  const inherited = {}, inheritedOrigins = {};
  const paths = ['captura.enabled','captura.businessDaysBefore','captura.hour','lembretes.before.enabled','lembretes.before.businessDays','lembretes.before.hour','lembretes.onDue.enabled','lembretes.onDue.hour','lembretes.after.enabled','lembretes.after.businessDays','lembretes.after.hour'];
  for (const tributo of AGENDA_TRIBUTOS) {
    inherited[tributo] = {}; inheritedOrigins[tributo] = {};
    for (const path of paths) {
      const parts = path.split('.'), patch = { tributos: { [tributo]: {} } };
      let at = patch.tributos[tributo];
      for (const part of parts.slice(0,-1)) at = at[part] = {};
      at[parts.at(-1)] = null;
      const result = resolverAgendaTributo(g.parameters, aplicarPatchAgenda(c.parameters, patch), tributo);
      const value = parts.reduce((v,k) => v?.[k], result.parameters);
      if (value !== undefined) {
        let target = inherited[tributo];
        for (const part of parts.slice(0,-1)) target = target[part] ||= {};
        target[parts.at(-1)] = value;
      }
      if (result.origins[path]) inheritedOrigins[tributo][path] = result.origins[path];
    }
  }
  return { schemaVersion: 1, revision: revision(local), globalRevision: revision(global), version: c.version,
    configured: Boolean(local), globalConfigured: Boolean(global), overrides: canonical(c.parameters),
    inherited, inheritedOrigins,
    effective: Object.fromEntries(resolved.map(r => [r.tributo, r.parameters])),
    origins: Object.fromEntries(resolved.map(r => [r.tributo, r.origins])),
    participation: Object.fromEntries(resolved.map(r => [r.tributo, r.participation])),
    prepared: true, ...mode,
    updatedAt: c.updatedAt, updatedBy: c.updatedBy };
}
async function write(tx, key, before, patch, userId) {
  const prior = decode(before);
  if (prior.version >= Number.MAX_SAFE_INTEGER) throw error('EVENT_POLICY_INVALID', 'Versão da configuração fora do limite suportado.');
  const parameters = aplicarPatchAgenda(prior.parameters, patch);
  // Persist participation only. Existing selections/flags/tokens are untouched.
  const value = { schemaVersion: 1, version: prior.version + 1, parameters,
    updatedAt: new Date().toISOString(), updatedBy: String(userId) };
  if (before) {
    const changed = await tx.appSetting.updateMany({ where: { key, value: { equals: before.value } }, data: { value } });
    if (changed.count !== 1) throw error('EVENT_POLICY_CHANGED', 'A configuração mudou. Recarregue antes de salvar.');
  } else await tx.appSetting.create({ data: { key, value } });
  return value;
}
// Only called inside the existing serializable company transaction, after ACL,
// company lock and composite expectedRevision validation by its owning service.
export async function gravarAgendaEventosEmpresaNoTx(tx, companyId, userId, input, beforeProjection) {
  const patch = validarPatchAgendaEmpresa(input);
  const current = await lerAgendaEventosEmpresa(tx, companyId);
  if (current.revision !== beforeProjection?.revision || current.globalRevision !== beforeProjection?.globalRevision)
    throw error('AUTOMATION_CHANGED', 'A herança da agenda mudou. Recarregue antes de salvar.');
  const key = companyKey(companyId), before = await tx.appSetting.findUnique({ where: { key } });
  if (Object.hasOwn(input, 'patch')) await write(tx, key, before, patch, userId);
  if (Object.hasOwn(input, 'executionMode')) await gravarModoEventosNoTx(tx, companyId, userId, input.executionMode, beforeProjection.modeRevision);
}
export async function salvarAgendaEventosGlobal(db, user, input) {
  if (!user?.id || !['admin', 'contador'].includes(String(user.role).toLowerCase())) throw error('FORBIDDEN', 'Acesso restrito ao escritório.', 403);
  validarPedidoAgendaGlobal(input);
  const { expectedRevision, patch } = input.agendaEventos;
  const key = `agenda_eventos_request:${user.id}:${input.requestId}`, fingerprint = hash(input);
  return db.$transaction(async tx => {
    const before = await tx.appSetting.findUnique({ where: { key: GLOBAL } });
    const current = publicPolicy(before);
    const request = await tx.appSetting.findUnique({ where: { key } });
    if (request) {
      if (request.value.hash !== fingerprint) throw error('IDEMPOTENCY_CONFLICT', 'A solicitação já corresponde a outros parâmetros.');
      if (request.value.result.revision !== current.revision) throw error('EVENT_POLICY_CHANGED', 'A configuração mudou após este salvamento.');
      return request.value.result;
    }
    if (current.revision !== expectedRevision) throw error('EVENT_POLICY_CHANGED', 'A configuração mudou. Recarregue antes de salvar.');
    const value = await write(tx, GLOBAL, before, patch, user.id);
    const result = publicPolicy({ value });
    await tx.appSetting.create({ data: { key, value: { hash: fingerprint, userId: String(user.id),
      eventId: randomUUID(), before: current, result } } });
    return result;
  }, { isolationLevel: 'Serializable' });
}
