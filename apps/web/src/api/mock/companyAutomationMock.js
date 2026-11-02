import { mockCarregarRotinas, mockSalvarRotinas, mockLerPausaCicloFiscal } from './rotinasMock';

export function aplicabilidadeRotinasMock(company) {
  const regime = String(company?.regimeTributario || company?.tipoTributario || company?.legacyCompany?.regimeTributario || company?.legacyCompany?.tipoTributario || '').trim().toUpperCase();
  const keys = { SIMPLES: ['das', 'extrato', 'parcelamento'], LUCRO_PRESUMIDO: ['presumido'], LUCRO_REAL: [] };
  return Object.hasOwn(keys, regime) ? { regime, applicableKeys: [...keys[regime], 'inss', 'pagamento', 'conferencia'], unavailableReason: null }
    : { regime: null, applicableKeys: [], unavailableReason: 'Regime tributário não confirmado no cadastro da empresa.' };
}

export function criarCompanyAutomationMock(companies) {
  const policies = new Map(), requests = new Map();
  const automationPolicies = new Map();
  const ciclos = new Map();
  const fail = (message, status = 409) => Object.assign(new Error(message), { status });
  async function getCompanyAutomation(companyId) {
    const data = mockCarregarRotinas(companies);
    const company = data.empresas.find(c => c.companyId === companyId);
    if (!company) throw fail('Empresa não encontrada.', 404);
    const serproPolicy = policies.get(companyId) || { paused: false, reason: '', updatedAt: null, updatedBy: null };
    const automationPolicy = automationPolicies.get(companyId) || { paused: false, version: 0, reason: '', updatedAt: null, updatedBy: null, resumedAt: null };
    const globalAutomationPolicy = mockLerPausaCicloFiscal().policy;
    const applicability = aplicabilidadeRotinasMock(companies.find(c => c.companyId === companyId));
    const rotinas = data.rotinas.filter(r => !['avisos_guias_whatsapp', 'simples_coleta_calculo'].includes(r.key)).map(r => ({ ...r, label: r.key === 'parcelamento' ? 'Parcelamento do Simples' : r.label, applicable: applicability.applicableKeys.includes(r.key), enabled: company.rotinas[r.key] === true, agenda: data.agenda[r.key] }));
    const cicloSimples = company.cicloSimples || { enabled: false, fontes: [] };
    const lembretes = { enabled: company.rotinas.avisos_guias_whatsapp === true, agenda: data.agenda.avisos_guias_whatsapp };
    return structuredClone({ companyId, revision: JSON.stringify([rotinas, serproPolicy, lembretes, automationPolicy, globalAutomationPolicy, cicloSimples]), rotinas, serproPolicy, automationPolicy, globalAutomationPolicy, cicloSimples,
      effectiveAutomationState: globalAutomationPolicy.paused ? 'GLOBAL_PAUSED' : automationPolicy.paused ? 'COMPANY_PAUSED' : 'SUBJECT_TO_SCHEDULE', lembretes, ...applicability });
  }
  async function getCompanySimplesCycle(companyId, competencia) {
    await getCompanyAutomation(companyId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw fail('Competência inválida.', 422);
    return structuredClone(ciclos.get(`${companyId}:${competencia}`) || { portalClientId: companyId, competencia, revision: 0, status: 'NAO_INICIADO', reason: null, coleta: null, calculo: null, updatedAt: null, canRevise: false });
  }
  return { getCompanyAutomation, getCompanySimplesCycle, async reviseCompanySimplesCycle(companyId, competencia, input) {
    const current = await getCompanySimplesCycle(companyId, competencia);
    if (input.expectedRevision !== current.revision || !current.canRevise) throw fail('Confira a tentativa antes de registrar nova revisão.');
    if (typeof input.motivo !== 'string' || input.motivo.trim().length < 3 || input.motivo.trim().length > 500) throw fail('Informe o motivo da revisão.', 422);
    const next = { ...current, revision: current.revision + 1, status: 'AGUARDANDO_COLETA_FINAL', canRevise: false, reason: 'Correção registrada. Aguarda próximo horário elegível.', coleta: null, calculo: null, updatedAt: new Date().toISOString() };
    ciclos.set(`${companyId}:${competencia}`, next);
    return structuredClone(next);
  }, async saveCompanyAutomation(companyId, input) {
    const identity = JSON.stringify([companyId, input]);
    if (requests.has(input.requestId)) {
      const saved = requests.get(input.requestId);
      if (identity !== saved.identity) throw fail('Esta solicitação pertence a outra alteração. Recarregue a configuração.');
      const current = await getCompanyAutomation(companyId);
      if (current.revision !== saved.result.revision) throw fail('A configuração mudou após este salvamento. Recarregue para conferir o estado atual.');
      return structuredClone(saved.result);
    }
    const current = await getCompanyAutomation(companyId);
    if (current.revision !== input.expectedRevision) throw fail('A configuração mudou em outra sessão. Recarregue antes de salvar.');
    if (input.cicloSimples !== undefined && (!input.cicloSimples || Array.isArray(input.cicloSimples) || typeof input.cicloSimples.enabled !== 'boolean' || !Array.isArray(input.cicloSimples.fontes)
      || input.cicloSimples.fontes.some(f => !['NFE', 'NFSE'].includes(f)) || new Set(input.cicloSimples.fontes).size !== input.cicloSimples.fontes.length
      || Object.keys(input.cicloSimples).some(k => !['enabled', 'fontes'].includes(k)) || (input.cicloSimples.enabled && (!input.cicloSimples.fontes.length || current.regime !== 'SIMPLES')))) throw fail('Revise as fontes e o regime do ciclo do Simples.', 422);
    if (input.serproPolicy && (typeof input.serproPolicy.paused !== 'boolean' || !input.serproPolicy.reason?.trim() || input.serproPolicy.reason.trim().length > 300)) throw fail('Informe o motivo da alteração.', 422);
    if (input.automationPolicy !== undefined && (!input.automationPolicy || Array.isArray(input.automationPolicy) || typeof input.automationPolicy.paused !== 'boolean'
      || typeof input.automationPolicy.reason !== 'string' || !input.automationPolicy.reason.trim() || input.automationPolicy.reason.trim().length > 300
      || Object.keys(input.automationPolicy).some(k => !['paused', 'reason'].includes(k)))) throw fail('Informe o motivo da alteração das automações.', 422);
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
    if (input.cicloSimples !== undefined) {
      const data = mockCarregarRotinas(companies);
      mockSalvarRotinas({ empresas: data.empresas.map(c => c.companyId === companyId ? { ...c, cicloSimples: structuredClone(input.cicloSimples) } : c) });
    }
    if (input.automationPolicy) {
      const updatedAt = new Date().toISOString();
      automationPolicies.set(companyId, { ...input.automationPolicy, reason: input.automationPolicy.reason.trim(), version: current.automationPolicy.version + 1,
        updatedAt, updatedBy: 'mock-user', resumedAt: !input.automationPolicy.paused && current.automationPolicy.paused ? updatedAt : current.automationPolicy.resumedAt });
    }
    const result = await getCompanyAutomation(companyId);
    requests.set(input.requestId, { identity, result });
    return structuredClone(result);
  } };
}
