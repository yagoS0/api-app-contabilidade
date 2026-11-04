import { criarReferenciaVencimentoMock } from './referenciaVencimentoMock';
import { mockLerAgendaEventos, mockSalvarAgendaEventos } from './agendaEventosMock';
import { mockCarregarRotinas, mockSalvarRotinas, mockLerPausaCicloFiscal } from './rotinasMock';
const copy = value => JSON.parse(JSON.stringify(value));

// Deterministic demo token, not a security hash. Production revisions are SHA256.
function demoRevision(value) {
  const text=JSON.stringify(value);
  return Array.from({length:8},(_,seed)=>{let n=2166136261+seed;for(let i=0;i<text.length;i++)n=Math.imul(n^text.charCodeAt(i),16777619);return (n>>>0).toString(16).padStart(8,'0');}).join('');
}
export function aplicabilidadeRotinasMock(company) {
  const regime = String(company?.regimeTributario || company?.tipoTributario || company?.legacyCompany?.regimeTributario || company?.legacyCompany?.tipoTributario || '').trim().toUpperCase();
  const keys = { SIMPLES: ['das', 'extrato', 'parcelamento'], LUCRO_PRESUMIDO: ['presumido'], LUCRO_REAL: [] };
  return Object.hasOwn(keys, regime) ? { regime, applicableKeys: [...keys[regime], 'inss', 'pagamento', 'conferencia'], unavailableReason: null }
    : { regime: null, applicableKeys: [], unavailableReason: 'Regime tributário não confirmado no cadastro da empresa.' };
}

export function criarCompanyAutomationMock(companies) {
  const policies = new Map(), requests = new Map();
  const referenceApi=criarReferenciaVencimentoMock({canRead:id=>companies.some(c=>c.companyId===id),canWrite:id=>companies.some(c=>c.companyId===id&&['ACCOUNTANT','FIRM_ADMIN'].includes(c.myRole))});
  const automationPolicies = new Map(), modes = new Map();
  const ciclos = new Map(), tracking = new Map();
  const fail = (message, status = 409) => Object.assign(new Error(message), { status });
  async function getCompanyAutomation(companyId) {
    const data = mockCarregarRotinas(companies);
    const company = data.empresas.find(c => c.companyId === companyId);
    if (!company) throw fail('Empresa não encontrada.', 404);
    const serproPolicy = policies.get(companyId) || { paused: false, reason: '', updatedAt: null, updatedBy: null };
    const automationPolicy = automationPolicies.get(companyId) || { paused: false, version: 0, reason: '', updatedAt: null, updatedBy: null, resumedAt: null };
    const globalAutomationPolicy = mockLerPausaCicloFiscal().policy;
    const applicability = aplicabilidadeRotinasMock(companies.find(c => c.companyId === companyId));
    const rotinas = data.rotinas.filter(r => !['avisos_guias_whatsapp', 'simples_coleta_calculo', 'simples_envio_guias'].includes(r.key)).map(r => ({ ...r, label: r.key === 'parcelamento' ? 'Parcelamento do Simples' : r.label, applicable: applicability.applicableKeys.includes(r.key), enabled: company.rotinas[r.key] === true, agenda: data.agenda[r.key] }));
    const envioGuias = { ...(company.envioGuias || { enabled: false }), applicableCurrentRegime: applicability.regime === 'SIMPLES', configurationValid: true };
    const cicloSimples = company.cicloSimples || { enabled: false, fontes: [] };
    const acompanhamentoGuias = tracking.get(companyId) || { enabled: false, politica: null, limiteConsultas: 0 };
    const lembretes = { enabled: company.rotinas.avisos_guias_whatsapp === true, agenda: data.agenda.avisos_guias_whatsapp };
    const mode=modes.get(companyId)||{executionMode:'LEGADO',modeVersion:0};
    const agendaEventos={...mockLerAgendaEventos(companyId),...mode,modeRevision:demoRevision(mode),modeConfigured:modes.has(companyId)};
    return copy({ companyId, companyName:company.razao||null, agendaEventos, revision: demoRevision([agendaEventos, rotinas, serproPolicy, lembretes, automationPolicy, globalAutomationPolicy, cicloSimples, envioGuias, acompanhamentoGuias]), acompanhamentoGuias, rotinas, serproPolicy, automationPolicy, globalAutomationPolicy, cicloSimples, envioGuias,
      effectiveAutomationState: globalAutomationPolicy.paused ? 'GLOBAL_PAUSED' : automationPolicy.paused ? 'COMPANY_PAUSED' : 'SUBJECT_TO_SCHEDULE', lembretes, ...applicability });
  }
  async function getCompanySimplesCycle(companyId, competencia) {
    await getCompanyAutomation(companyId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw fail('Competência inválida.', 422);
    return copy(ciclos.get(`${companyId}:${competencia}`) || { portalClientId: companyId, competencia, revision: 0, status: 'NAO_INICIADO', reason: null, coleta: null, calculo: null, updatedAt: null, canRevise: false });
  }
  async function getCompanyGuideDelivery(companyId, competencia) {
    const data = await getCompanyAutomation(companyId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw fail('Competência inválida.', 422);
    return { ok: true, portalClientId: companyId, competencia, revision: 0, status: 'DISABLED', enabled: false, paused: data.automationPolicy.paused || data.globalAutomationPolicy.paused, cutoffDate: null, expectation: { state: 'REVIEW', missing: [], requiredCount: 0, availableCount: 0 }, items: [], warnings: [{ id: 'demo', message: 'Demonstração: nenhum envio real é realizado.' }], lastAttempt: null };
  }
  async function getCompanyGuideTracking(companyId, competencia) {
    const data = await getCompanyAutomation(companyId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw fail('Competência inválida.', 422);
    return { ok: true, portalClientId: companyId, competencia, ...data.acompanhamentoGuias, paused: data.automationPolicy.paused || data.globalAutomationPolicy.paused,
      items: [], template: { status: 'A_CONFERIR', mensagem: 'Demonstração: modelos e entregas não comprovados; nenhuma saída real.' } };
  }
  return { ...referenceApi, getCompanyGuideTracking, getCompanyAutomation, getCompanyGuideDelivery, getCompanySimplesCycle, async reviseCompanySimplesCycle(companyId, competencia, input) {
    const current = await getCompanySimplesCycle(companyId, competencia);
    if (input.expectedRevision !== current.revision || !current.canRevise) throw fail('Confira a tentativa antes de registrar nova revisão.');
    if (typeof input.motivo !== 'string' || input.motivo.trim().length < 3 || input.motivo.trim().length > 500) throw fail('Informe o motivo da revisão.', 422);
    const next = { ...current, revision: current.revision + 1, status: 'AGUARDANDO_COLETA_FINAL', canRevise: false, reason: 'Correção registrada. Aguarda próximo horário elegível.', coleta: null, calculo: null, updatedAt: new Date().toISOString() };
    ciclos.set(`${companyId}:${competencia}`, next);
    return copy(next);
  }, async saveCompanyAutomation(companyId, input) {
    const member=companies.find(c=>c.companyId===companyId);
    if(input?.agendaEventos&&(!member||!['ACCOUNTANT','FIRM_ADMIN'].includes(member.myRole)))throw fail('Acesso não permite alterar esta empresa.',403);
    const identity = JSON.stringify([companyId, input]);
    if (requests.has(input.requestId)) {
      const saved = requests.get(input.requestId);
      if (identity !== saved.identity) throw fail('Esta solicitação pertence a outra alteração. Recarregue a configuração.');
      const current = await getCompanyAutomation(companyId);
      if (current.revision !== saved.result.revision) throw fail('A configuração mudou após este salvamento. Recarregue para conferir o estado atual.');
      return copy(saved.result);
    }
    const current = await getCompanyAutomation(companyId);
    if (current.revision !== input.expectedRevision) throw fail('A configuração mudou em outra sessão. Recarregue antes de salvar.');
    if(input.agendaEventos!==undefined){
      if(Object.keys(input).some(key=>!['expectedRevision','requestId','agendaEventos'].includes(key))||!input.agendaEventos||Object.keys(input.agendaEventos).length!==1||Object.keys(input.agendaEventos).some(key=>!['patch','executionMode'].includes(key)))throw fail('Na demonstração, salve parâmetros separadamente das adesões.',422);
      if(Object.hasOwn(input.agendaEventos,'executionMode')){
        if(input.agendaEventos.executionMode!=='RELATIVO_V1')throw fail('Calendário inválido.',422);
        if(current.agendaEventos.executionMode!=='RELATIVO_V1')modes.set(companyId,{executionMode:'RELATIVO_V1',modeVersion:current.agendaEventos.modeVersion+1});
      }else mockSalvarAgendaEventos(companyId,{expectedRevision:current.agendaEventos.revision,requestId:input.requestId,patch:input.agendaEventos.patch});
      const result=await getCompanyAutomation(companyId);requests.set(input.requestId,{identity,result});return copy(result);
    }
    if (input.acompanhamentoGuias !== undefined && (!input.acompanhamentoGuias || Array.isArray(input.acompanhamentoGuias)
      || typeof input.acompanhamentoGuias.enabled !== 'boolean' || input.acompanhamentoGuias.politica !== 'D2_D0_D2_V1' || input.acompanhamentoGuias.limiteConsultas !== 1
      || Object.keys(input.acompanhamentoGuias).some(k => !['enabled', 'politica', 'limiteConsultas'].includes(k)))) throw fail('Revise o contrato e limite de consulta do acompanhamento.', 422);
    if (input.envioGuias !== undefined && (!input.envioGuias || Array.isArray(input.envioGuias) || typeof input.envioGuias.enabled !== 'boolean' || Object.keys(input.envioGuias).some(k => k !== 'enabled') || input.envioGuias.enabled && !current.envioGuias.enabled && current.regime !== 'SIMPLES')) throw fail('Revise a seleção do envio automático.', 422);
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
    if (input.envioGuias !== undefined) {
      const data = mockCarregarRotinas(companies);
      mockSalvarRotinas({ empresas: data.empresas.map(c => c.companyId === companyId ? { ...c, envioGuias: copy(input.envioGuias) } : c) });
    }
    if (input.cicloSimples !== undefined) {
      const data = mockCarregarRotinas(companies);
      mockSalvarRotinas({ empresas: data.empresas.map(c => c.companyId === companyId ? { ...c, cicloSimples: copy(input.cicloSimples) } : c) });
    }
    if (input.automationPolicy) {
      const updatedAt = new Date().toISOString();
      automationPolicies.set(companyId, { ...input.automationPolicy, reason: input.automationPolicy.reason.trim(), version: current.automationPolicy.version + 1,
        updatedAt, updatedBy: 'mock-user', resumedAt: !input.automationPolicy.paused && current.automationPolicy.paused ? updatedAt : current.automationPolicy.resumedAt });
    }
    if (input.acompanhamentoGuias !== undefined) tracking.set(companyId, copy(input.acompanhamentoGuias));
    const result = await getCompanyAutomation(companyId);
    requests.set(input.requestId, { identity, result });
    return copy(result);
  } };
}
