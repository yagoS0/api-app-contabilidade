import { mockCarregarRotinas, mockSalvarRotinas } from './rotinasMock';

export function aplicabilidadeRotinasMock(company) {
  const regime = String(company?.regimeTributario || company?.tipoTributario || company?.legacyCompany?.regimeTributario || company?.legacyCompany?.tipoTributario || '').trim().toUpperCase();
  const keys = { SIMPLES: ['das', 'extrato', 'parcelamento'], LUCRO_PRESUMIDO: ['presumido'], LUCRO_REAL: [] };
  return Object.hasOwn(keys, regime) ? { regime, applicableKeys: [...keys[regime], 'inss', 'pagamento', 'conferencia'], unavailableReason: null }
    : { regime: null, applicableKeys: [], unavailableReason: 'Regime tributário não confirmado no cadastro da empresa.' };
}

export function criarCompanyAutomationMock(companies) {
  const policies = new Map(), requests = new Map();
  const fail = (message, status = 409) => Object.assign(new Error(message), { status });
  async function getCompanyAutomation(companyId) {
    const data = mockCarregarRotinas(companies);
    const company = data.empresas.find(c => c.companyId === companyId);
    if (!company) throw fail('Empresa não encontrada.', 404);
    const serproPolicy = policies.get(companyId) || { paused: false, reason: '', updatedAt: null, updatedBy: null };
    const applicability = aplicabilidadeRotinasMock(companies.find(c => c.companyId === companyId));
    const rotinas = data.rotinas.filter(r => r.key !== 'avisos_guias_whatsapp').map(r => ({ ...r, label: r.key === 'parcelamento' ? 'Parcelamento do Simples' : r.label, applicable: applicability.applicableKeys.includes(r.key), enabled: company.rotinas[r.key] === true, agenda: data.agenda[r.key] }));
    const lembretes = { enabled: company.rotinas.avisos_guias_whatsapp === true, agenda: data.agenda.avisos_guias_whatsapp };
    return structuredClone({ companyId, revision: JSON.stringify([rotinas, serproPolicy, lembretes]), rotinas, serproPolicy, lembretes, ...applicability });
  }
  return { getCompanyAutomation, async saveCompanyAutomation(companyId, input) {
    const identity = JSON.stringify([companyId, input]);
    if (requests.has(input.requestId)) {
      const saved = requests.get(input.requestId);
      if (identity !== saved.identity) throw fail('Esta solicitação pertence a outra alteração. Recarregue a configuração.');
      return structuredClone(saved.result);
    }
    const current = await getCompanyAutomation(companyId);
    if (current.revision !== input.expectedRevision) throw fail('A configuração mudou em outra sessão. Recarregue antes de salvar.');
    if (input.serproPolicy && (typeof input.serproPolicy.paused !== 'boolean' || !input.serproPolicy.reason?.trim() || input.serproPolicy.reason.trim().length > 300)) throw fail('Informe o motivo da alteração.', 422);
    if (input.lembretes !== undefined && (!input.lembretes || Array.isArray(input.lembretes) || typeof input.lembretes.enabled !== 'boolean' || Object.keys(input.lembretes).some(k => k !== 'enabled'))) throw fail('Revise os lembretes.', 422);
    if (input.rotinas) {
      if (Object.keys(input.rotinas).some(key => !current.applicableKeys.includes(key))) throw fail('Rotina não aplicável ao regime tributário desta empresa.', 422);
      const data = mockCarregarRotinas(companies);
      mockSalvarRotinas({ empresas: data.empresas.map(c => c.companyId === companyId ? { ...c, rotinas: { ...c.rotinas, ...input.rotinas } } : c) });
    }
    if (input.lembretes !== undefined) {
      const data = mockCarregarRotinas(companies);
      mockSalvarRotinas({ empresas: data.empresas.map(c => c.companyId === companyId ? { ...c, rotinas: { ...c.rotinas, avisos_guias_whatsapp: input.lembretes.enabled } } : c) });
    }
    if (input.serproPolicy) policies.set(companyId, { paused: input.serproPolicy.paused, reason: input.serproPolicy.reason.trim(), updatedAt: new Date().toISOString(), updatedBy: 'mock-user' });
    const result = await getCompanyAutomation(companyId);
    requests.set(input.requestId, { identity, result });
    return structuredClone(result);
  } };
}
