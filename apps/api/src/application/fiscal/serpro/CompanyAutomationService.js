import { createHash, randomUUID } from 'node:crypto';
import { ROTINA_KEYS } from './SerproRuntimeSettings.js';
import { ROTINA_LABELS } from './CompanyRotinasService.js';
import { lerPoliticaSerpro, chavePoliticaSerpro, bloquearPoliticaEmpresa } from './CompanySerproPolicy.js';
import { aplicarRegimeRotinas, labelRotinaAplicavel } from './CompanyRoutineApplicability.js';

const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
export async function lerAutomacaoEmpresa(db, companyId) {
  const company = await db.portalClient.findUnique({ where: { id: companyId }, select: { id: true, companyId: true } });
  if (!company) throw fail('COMPANY_NOT_FOUND', 'Empresa não encontrada.', 404);
  const legacy = company.companyId ? await db.company.findUnique({ where: { id: company.companyId }, select: { regimeTributario: true, tipoTributario: true } }) : null;
  const applicability = aplicarRegimeRotinas(legacy);
  const rows = await db.companyRotina.findMany({ where: { portalClientId: companyId }, orderBy: { rotina: 'asc' } });
  const setting = await db.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } });
  // Somente agenda salva. Não retornar credenciais nem inferir habilitação de defaults.
  const agenda = Object.fromEntries(ROTINA_KEYS.map(key => {
    const r = setting?.value?.rotinas?.[key];
    const integer = (v, min, max) => (typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v)) && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
    const valid = r && integer(r.day, 1, 31) && integer(r.hour, 0, 23) && (r.frequency == null || r.frequency === 'MONTHLY' || key === 'pagamento' && r.frequency === 'DAILY');
    return [key, r ? { enabled: r.enabled === true && Boolean(valid), day: valid ? Number(r.day) : null, hour: valid ? Number(r.hour) : null, frequency: r.frequency ?? 'MONTHLY' } : null];
  }));
  const serproPolicy = await lerPoliticaSerpro(db, companyId);
  const revision = createHash('sha256').update(JSON.stringify([companyId, rows.map(r => [r.rotina, r.enabled, r.updatedAt]), agenda, serproPolicy, applicability])).digest('hex');
  return { companyId, revision, serproPolicy, ...applicability, rotinas: ROTINA_KEYS.map(key => ({ key, label: labelRotinaAplicavel(key, ROTINA_LABELS), applicable: applicability.applicableKeys.includes(key), enabled: rows.some(r => r.rotina === key && r.enabled), agenda: agenda[key] })) };
}

export async function salvarAutomacaoEmpresa(db, companyId, userId, input, { isAdmin = false } = {}) {
  const { expectedRevision, requestId, rotinas, serproPolicy } = input || {};
  const validRoutines = rotinas === undefined || rotinas && !Array.isArray(rotinas) && typeof rotinas === 'object'
    && Object.keys(rotinas).length > 0 && Object.entries(rotinas).every(([k, v]) => ROTINA_KEYS.includes(k) && typeof v === 'boolean');
  const validPolicy = serproPolicy === undefined || serproPolicy && !Array.isArray(serproPolicy) && typeof serproPolicy === 'object'
    && typeof serproPolicy.paused === 'boolean' && typeof serproPolicy.reason === 'string'
    && serproPolicy.reason.trim().length > 0 && serproPolicy.reason.trim().length <= 300
    && Object.keys(serproPolicy).every(k => ['paused', 'reason'].includes(k));
  if (!/^[a-f0-9]{64}$/.test(expectedRevision || '') || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId || '')
    || !validRoutines || !validPolicy || rotinas === undefined && serproPolicy === undefined) {
    throw fail('INVALID_AUTOMATION', 'Revise as rotinas selecionadas e atualize a configuração antes de salvar.', 422);
  }
  const key = `company_automation_request:${userId}:${requestId}`;
  const policyInput = serproPolicy === undefined ? null : { paused: serproPolicy.paused, reason: serproPolicy.reason.trim() };
  const hash = createHash('sha256').update(JSON.stringify([companyId, expectedRevision, Object.entries(rotinas || {}).sort(), policyInput])).digest('hex');
  return db.$transaction(async tx => {
    await bloquearPoliticaEmpresa(tx, companyId);
    if (!isAdmin) {
      const access = await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: String(userId) } } });
      if (access?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(access.role)) throw fail('ACCESS_CHANGED', 'Seu acesso não permite alterar as consultas desta empresa.', 403);
    }
    const saved = await tx.appSetting.findUnique({ where: { key } });
    if (saved) {
      if (saved.value.hash !== hash) throw fail('IDEMPOTENCY_CONFLICT', 'Esta solicitação pertence a outra alteração. Recarregue a configuração.');
      return saved.value.result;
    }
    const before = await lerAutomacaoEmpresa(tx, companyId);
    if (before.revision !== expectedRevision) throw fail('AUTOMATION_CHANGED', 'A configuração mudou em outra sessão. Recarregue antes de salvar.');
    if (Object.entries(rotinas || {}).some(([key, enabled]) => enabled && !before.applicableKeys.includes(key))) {
      throw fail('ROUTINE_NOT_APPLICABLE', before.unavailableReason || 'Esta rotina não se aplica ao regime cadastrado da empresa. Recarregue a configuração.', 422);
    }
    for (const [rotina, enabled] of Object.entries(rotinas || {})) {
      await tx.companyRotina.upsert({ where: { portalClientId_rotina: { portalClientId: companyId, rotina } }, create: { portalClientId: companyId, rotina, enabled }, update: { enabled } });
    }
    if (policyInput) {
      const value = { ...policyInput, updatedAt: new Date().toISOString(), updatedBy: String(userId) };
      await tx.appSetting.upsert({ where: { key: chavePoliticaSerpro(companyId) }, create: { key: chavePoliticaSerpro(companyId), value }, update: { value } });
    }
    const result = { ...await lerAutomacaoEmpresa(tx, companyId), savedAt: new Date().toISOString() };
    await tx.appSetting.create({ data: { key, value: { hash, companyId, userId, before: before.rotinas.map(r => ({ key: r.key, enabled: r.enabled })), beforeSerproPolicy: before.serproPolicy, result, eventId: randomUUID() } } });
    return result;
  }, { isolationLevel: 'Serializable' });
}
