// Identidade desta política é sempre PortalClient, nunca Company.
export const chavePoliticaAutomacao = portalClientId => `company_automation_policy:${portalClientId}`;
const fail = (code, message) => Object.assign(new Error(message), { code, status: 409 });
export async function lerPoliticaAutomacao(db, portalClientId) {
  try {
    if (typeof portalClientId !== 'string' || !portalClientId.trim()) throw new Error('identity');
    const company = await db.portalClient.findUnique({ where: { id: portalClientId }, select: { id: true } });
    if (company?.id !== portalClientId) throw new Error('identity');
    const row = await db.appSetting.findUnique({ where: { key: chavePoliticaAutomacao(portalClientId) } });
    if (row === null) return { paused: false, version: 0, reason: '', updatedAt: null, updatedBy: null, resumedAt: null };
    const v = row?.value;
    if (!v || typeof v.paused !== 'boolean' || !Number.isSafeInteger(v.version) || v.version < 1
      || typeof v.reason !== 'string' || !v.reason.trim() || !v.updatedBy
      || !Number.isFinite(Date.parse(v.updatedAt)) || (v.resumedAt !== null && !Number.isFinite(Date.parse(v.resumedAt)))) throw new Error('policy');
    return { paused: v.paused, version: v.version, reason: v.reason, updatedAt: v.updatedAt, updatedBy: v.updatedBy, resumedAt: v.resumedAt };
  } catch {
    throw fail('AUTOMACAO_EMPRESA_INDISPONIVEL', 'Não foi possível conferir a identidade ou a pausa da empresa. Nenhuma automação foi autorizada.');
  }
}
export async function conferirPoliticaAutomacao(db, portalClientId, { version, scheduledAt } = {}) {
  const policy = await lerPoliticaAutomacao(db, portalClientId);
  if (policy.paused) throw fail('AUTOMACAO_EMPRESA_PAUSADA', `Automações desta empresa pausadas: ${policy.reason}`);
  if (version !== undefined && policy.version !== version) throw fail('AUTOMACAO_EMPRESA_REVISAO_ALTERADA', 'A pausa empresarial mudou. Confira a execução antes de retomá-la.');
  if (scheduledAt && policy.resumedAt && Date.parse(scheduledAt) <= Date.parse(policy.resumedAt)) throw fail('AUTOMACAO_EMPRESA_HORARIO_ANTERIOR', 'Horário anterior à retomada da empresa; confira manualmente a pendência.');
  return policy;
}
