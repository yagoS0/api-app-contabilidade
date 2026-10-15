import { createHash, randomUUID } from 'node:crypto';
import { ROTINA_KEYS } from './SerproRuntimeSettings.js';
import { ROTINA_LABELS } from './CompanyRotinasService.js';

const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
export async function lerAutomacaoEmpresa(db, companyId) {
  const company = await db.portalClient.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw fail('COMPANY_NOT_FOUND', 'Empresa não encontrada.', 404);
  const rows = await db.companyRotina.findMany({ where: { portalClientId: companyId }, orderBy: { rotina: 'asc' } });
  const setting = await db.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } });
  // Somente agenda salva. Não retornar credenciais nem inferir habilitação de defaults.
  const agenda = Object.fromEntries(ROTINA_KEYS.map(key => {
    const r = setting?.value?.rotinas?.[key];
    const integer = (v, min, max) => (typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v)) && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
    const valid = r && integer(r.day, 1, 31) && integer(r.hour, 0, 23) && (r.frequency == null || r.frequency === 'MONTHLY' || key === 'pagamento' && r.frequency === 'DAILY');
    return [key, r ? { enabled: r.enabled === true && Boolean(valid), day: valid ? Number(r.day) : null, hour: valid ? Number(r.hour) : null, frequency: r.frequency ?? 'MONTHLY' } : null];
  }));
  const revision = createHash('sha256').update(JSON.stringify([companyId, rows.map(r => [r.rotina, r.enabled, r.updatedAt]), agenda])).digest('hex');
  return { companyId, revision, rotinas: ROTINA_KEYS.map(key => ({ key, label: ROTINA_LABELS[key], enabled: rows.some(r => r.rotina === key && r.enabled), agenda: agenda[key] })) };
}

export async function salvarAutomacaoEmpresa(db, companyId, userId, input, { isAdmin = false } = {}) {
  const { expectedRevision, requestId, rotinas } = input || {};
  if (!/^[a-f0-9]{64}$/.test(expectedRevision || '') || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId || '')
    || !rotinas || Array.isArray(rotinas) || typeof rotinas !== 'object' || !Object.keys(rotinas).length
    || Object.entries(rotinas).some(([k, v]) => !ROTINA_KEYS.includes(k) || typeof v !== 'boolean')) {
    throw fail('INVALID_AUTOMATION', 'Revise as rotinas selecionadas e atualize a configuração antes de salvar.', 422);
  }
  const key = `company_automation_request:${userId}:${requestId}`;
  const hash = createHash('sha256').update(JSON.stringify([companyId, expectedRevision, Object.entries(rotinas).sort()])).digest('hex');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`company_automation:${companyId}`}))::text`;
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
    for (const [rotina, enabled] of Object.entries(rotinas)) {
      await tx.companyRotina.upsert({ where: { portalClientId_rotina: { portalClientId: companyId, rotina } }, create: { portalClientId: companyId, rotina, enabled }, update: { enabled } });
    }
    const result = { ...await lerAutomacaoEmpresa(tx, companyId), savedAt: new Date().toISOString() };
    await tx.appSetting.create({ data: { key, value: { hash, companyId, userId, before: before.rotinas.map(r => ({ key: r.key, enabled: r.enabled })), result, eventId: randomUUID() } } });
    return result;
  }, { isolationLevel: 'Serializable' });
}
