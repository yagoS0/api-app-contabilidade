import { CompanyGuideTracking } from './CompanyGuideTracking';
import { CompanyGuideDelivery } from './CompanyGuideDelivery';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useEdicaoPendente } from '../configuracoes/ProtecaoEdicao.shared.js';
import './operacoes.css';
import { CompanyManualInss } from './OperationsManualInss';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';

const cycleLabels = { NAO_INICIADO: 'Não iniciado', COLETANDO: 'Coletando notas', COLETA_PARCIAL: 'Coleta incompleta', AGUARDANDO_COLETA_FINAL: 'Aguardando coleta final', REVISAO_NECESSARIA: 'Revisão necessária', CALCULANDO: 'Calculando', CALCULADO: 'Calculado · aguardando contador', INCERTO: 'Resultado incerto · conferir tentativa' };
function cycleMoney(value) {
  if (value == null || !/^\d+(\.\d{1,2})?$/.test(String(value))) return 'A verificar';
  const [whole, fraction = ''] = String(value).split('.');
  return `R$ ${whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction.padEnd(2, '0')}`;
}
function cycleDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'A verificar';
}
function OpenCycleApuracao({ companyId, disabled }) {
  const navigate = useNavigate();
  const destination = companyTabPath(companyId, 'cadastroFiscal');
  return <Button variant="secondary" disabled={disabled || !destination} onClick={() => navigate(destination)}>Abrir Apuração</Button>;
}
function previousMonth() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${Number(parts.month) === 1 ? Number(parts.year) - 1 : parts.year}-${String(Number(parts.month) === 1 ? 12 : Number(parts.month) - 1).padStart(2, '0')}`;
}
export function CompanySimplesCycle({ api, companyId, canEdit, configurationPending = false }) {
  const routed = useInRouterContext();
  const [competencia, setCompetencia] = useState(previousMonth);
  const [cycle, setCycle] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [motivo, setMotivo] = useState(''), [review, setReview] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const generation = useRef(0), working = useRef(false), focus = useRef(null), resultRef = useRef(null), reasonRef = useRef(null), confirmationRef = useRef(null);
  useEdicaoPendente(Boolean(motivo.trim()));
  useEffect(() => {
    if (busy || !focus.current) return;
    const requested = focus.current; focus.current = null;
    if (requested.generation === generation.current && [document.body, requested.origin].includes(document.activeElement)) (requested.reason ? reasonRef : requested.confirmation ? confirmationRef : resultRef).current?.focus();
  }, [busy, cycle, error, notice, review]);
  const valid = value => value && value.ok !== false && value.portalClientId === companyId && value.competencia === competencia && Number.isInteger(value.revision) && cycleLabels[value.status];
  const load = useCallback(async (event) => {
    const ticket = ++generation.current;
    focus.current = event?.type ? { generation: ticket, origin: document.activeElement } : null;
    working.current = true; setBusy(true); setCycle(null); setError(''); setNotice(''); setReview(false); setNeedsReload(false);
    try {
      if (!api.getCompanySimplesCycle) throw new Error('Consulta do ciclo indisponível nesta conexão.');
      const value = await api.getCompanySimplesCycle(companyId, competencia);
      if (ticket !== generation.current) return;
      if (!value || value.ok === false || value.portalClientId !== companyId || value.competencia !== competencia || !Number.isInteger(value.revision) || !cycleLabels[value.status]) throw new Error('Não foi possível confirmar o ciclo desta empresa e competência.');
      setCycle(value);
    } catch (e) { if (ticket === generation.current) setError(e.message || 'Não foi possível carregar o ciclo.'); }
    finally { if (ticket === generation.current) { working.current = false; setBusy(false); } }
  }, [api, companyId, competencia]);
  useEffect(() => { setMotivo(''); load(); return () => { generation.current++; }; }, [load]);
  async function revise() {
    if (working.current || !review || !canEdit || configurationPending || needsReload || !cycle?.canRevise || motivo.trim().length < 3 || ['INCERTO', 'CALCULANDO', 'COLETANDO'].includes(cycle.status)) return;
    const ticket = generation.current;
    focus.current = { generation: ticket, origin: document.activeElement };
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const value = await api.reviseCompanySimplesCycle(companyId, competencia, { expectedRevision: cycle.revision, motivo: motivo.trim() });
      if (ticket !== generation.current) return;
      if (!valid(value) || value.revision !== cycle.revision + 1) throw new Error('Não foi possível confirmar a nova revisão. Recarregue antes de continuar.');
      setCycle(value); setMotivo(''); setReview(false); setNotice('Revisão registrada. Nenhum cálculo ou transmissão foi iniciado agora. A janela automática vai do dia 1 ao dia 8 do mês seguinte à competência; fora dela, prossiga pela Apuração.');
    } catch (e) { if (ticket === generation.current) { setError(e.message || 'Não foi possível confirmar a revisão. Recarregue antes de continuar.'); setNeedsReload(true); } }
    finally { if (ticket === generation.current) { working.current = false; setBusy(false); } }
  }
  const locked = busy || configurationPending;
  return <section className="operacoes-previa" aria-label="Ciclo do Simples por competência" style={{ marginBlock: 20 }}>
    <h3>Ciclo por competência</h3>
    <label>Competência <input type="month" value={competencia} disabled={locked || Boolean(motivo.trim())} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setCompetencia(e.target.value); }} /></label>{' '}
    <Button variant="secondary" disabled={locked} onClick={load}>Atualizar ciclo</Button>
    <div ref={resultRef} tabIndex={-1} role={error ? 'alert' : 'status'}>
      {busy ? <p>Carregando ciclo…</p> : error ? <p>{error}</p> : cycle && <><p><strong>{cycleLabels[cycle.status]}</strong> · Revisão {cycle.revision}</p>{cycle.reason && <p>{cycle.reason}</p>}</>}
      {notice && <p>{notice}</p>}
    </div>
    {cycle && !busy && <>
      {cycle.coleta && <ul>{Object.entries(cycle.coleta).map(([fonte, value]) => <li key={fonte}>{fonte === 'NFE' ? 'NF-e' : fonte === 'NFSE' ? 'NFS-e' : fonte}: {value.complete ? 'coleta completa' : 'coleta incompleta'}{Number.isInteger(value.totalDocs) ? ` · ${value.totalDocs} documentos` : ''}{value.reason ? ` · ${value.reason}` : ''}</li>)}</ul>}
      {cycle.calculo?.calculoId && <><p>Imposto calculado: <strong>{cycleMoney(cycle.calculo.dasValor)}</strong></p><p>Calculado em {cycleDate(cycle.calculo.completedAt)} · Brasília. Confira os valores e as notas na Apuração antes de confirmar.</p></>}
      {routed && <><p>Na Apuração, confira a competência {competencia.split('-').reverse().join('/')} no seletor da empresa.</p><OpenCycleApuracao companyId={companyId} disabled={locked || Boolean(motivo.trim())} /></>}
      {cycle.status === 'INCERTO' && <p>Confira o resultado da tentativa antes de uma nova revisão. Não haverá repetição automática.</p>}
      {canEdit && cycle.canRevise && !['INCERTO', 'CALCULANDO', 'COLETANDO'].includes(cycle.status) && <>
        <label style={{ display: 'grid', gap: 8 }}>Motivo da nova revisão<textarea ref={reasonRef} value={motivo} rows={2} maxLength={500} disabled={locked || review || needsReload} onChange={e => setMotivo(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', font: 'inherit' }} /></label>
        {review ? <><p ref={confirmationRef} tabIndex={-1}>Registrar uma nova revisão após a correção? O histórico será preservado. A janela automática vai do dia 1 ao dia 8 do mês seguinte à competência. Fora dela, prossiga pela Apuração; horários perdidos não são recuperados.</p><Button disabled={locked || needsReload || motivo.trim().length < 3} onClick={revise}>Registrar nova revisão</Button>{' '}<Button variant="secondary" disabled={busy} onClick={() => { focus.current = { generation: generation.current, origin: document.activeElement, reason: true }; setReview(false); }}>Voltar ao motivo</Button></> : <Button disabled={locked || needsReload || motivo.trim().length < 3} onClick={() => { focus.current = { generation: generation.current, origin: document.activeElement, confirmation: true }; setReview(true); }}>Conferir nova revisão</Button>}
      </>}
      {configurationPending && <p>Conclua ou descarte as alterações da configuração antes de revisar o ciclo.</p>}
    </>}
  </section>;
}

export function CompanyAutomation({ api, companyId, canEdit }) {
  const [data, setData] = useState(null), [values, setValues] = useState({});
  const [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState(false);
  const [paused, setPaused] = useState(false), [reason, setReason] = useState('');
  const [automationPaused, setAutomationPaused] = useState(false), [automationReason, setAutomationReason] = useState('');
  const [envioGuias, setEnvioGuias] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [cicloSimples, setCicloSimples] = useState({ enabled: false, fontes: [] });
  const [reloadRequired, setReloadRequired] = useState(false);
  const generation = useRef(0), pending = useRef(null);
  const focusRequest = useRef(null);
  const headingRef = useRef(null), previewRef = useRef(null), reviewRef = useRef(null);
  const errorRef = useRef(null), savedRef = useRef(null);
  useEffect(() => {
    const request = focusRequest.current;
    if (busy || !request) return;
    focusRequest.current = null;
    if (request.generation !== generation.current) return;
    if (document.activeElement !== document.body && document.activeElement !== request.origin) return;
    const target = error ? errorRef : request.target === 'preview' ? previewRef
      : request.target === 'review' ? reviewRef : request.target === 'saved' ? savedRef : headingRef;
    target.current?.focus();
  }, [busy, error, saved, preview, data]);
  const requestFocus = target => { focusRequest.current = { target, generation: generation.current, origin: document.activeElement }; };
  const changes = (data?.rotinas || []).filter(r => r.applicable !== false && values[r.key] !== r.enabled);
  const policyChanged = paused !== (data?.serproPolicy?.paused === true);
  const automationChanged = automationPaused !== (data?.automationPolicy?.paused === true);
  const envioChanged = envioGuias !== (data?.envioGuias?.enabled === true);
  const trackingChanged = tracking !== (data?.acompanhamentoGuias?.enabled === true);
  const remindersChanged = reminders !== (data?.lembretes?.enabled === true);
  const cicloApplicable = data?.cicloSimples?.applicableCurrentRegime ?? data?.regime === 'SIMPLES';
  const cicloChanged = cicloSimples.enabled !== (data?.cicloSimples?.enabled === true) || JSON.stringify([...cicloSimples.fontes].sort()) !== JSON.stringify([...(data?.cicloSimples?.fontes || [])].sort());
  const cicloInvalid = cicloSimples.enabled && !cicloSimples.fontes.length;
  const hasChanges = !!data && (changes.length > 0 || policyChanged || remindersChanged || automationChanged || cicloChanged || envioChanged || trackingChanged);
  const locked = !canEdit || busy || preview || !!pending.current || reloadRequired;
  useEdicaoPendente(hasChanges);
  const load = useCallback(async (event) => {
    const current = ++generation.current;
    focusRequest.current = event?.type ? { target: 'loaded', generation: current, origin: document.activeElement } : null;
    setBusy(true); setError(''); setSaved(''); setPreview(false); setData(null); setReloadRequired(false); pending.current = null;
    try {
      if (!api.getCompanyAutomation) throw new Error('Configuração disponível somente com a API conectada.');
      const r = await api.getCompanyAutomation(companyId);
      if (generation.current !== current) return;
      if (!r || r.ok === false || !r.revision || !Array.isArray(r.rotinas) || (r.companyId && r.companyId !== companyId)) throw new Error('Não foi possível confirmar a configuração desta empresa. Recarregue para conferir.');
      setData(r); setValues(Object.fromEntries(r.rotinas.map(x => [x.key, x.enabled]))); pending.current = null;
      setPaused(r.serproPolicy?.paused === true); setReason(''); setReminders(r.lembretes?.enabled === true); setTracking(r.acompanhamentoGuias?.enabled === true); setEnvioGuias(r.envioGuias?.enabled === true);
      setAutomationPaused(r.automationPolicy?.paused === true); setAutomationReason('');
      setCicloSimples({ enabled: r.cicloSimples?.enabled === true, fontes: r.cicloSimples?.fontes || [] });
    } catch (e) { if (generation.current === current) setError(e.message || 'Não foi possível carregar a configuração.'); }
    finally { if (generation.current === current) setBusy(false); }
  }, [api, companyId]);
  useEffect(() => { const generationDaExecucao = generation; setData(null); setSaved(''); load(); return () => { generationDaExecucao.current++; }; }, [load, companyId, api]);
  async function save() {
    if (!canEdit || busy || reloadRequired || !preview || !hasChanges || cicloInvalid || (policyChanged && !reason.trim()) || (automationChanged && !automationReason.trim())) return;
    const current = generation.current;
    const input = pending.current || { expectedRevision: data.revision, requestId: crypto.randomUUID(),
      ...(automationChanged ? { automationPolicy: { paused: automationPaused, reason: automationReason.trim() } } : {}),
      ...(trackingChanged ? { acompanhamentoGuias: { enabled: tracking, politica: 'D2_D0_D2_V1', limiteConsultas: 1 } } : {}),
      ...(remindersChanged ? { lembretes: { enabled: reminders } } : {}),
      ...(envioChanged ? { envioGuias: { enabled: envioGuias } } : {}),
      ...(cicloChanged ? { cicloSimples } : {}),
      ...(changes.length ? { rotinas: Object.fromEntries(changes.map(r => [r.key, values[r.key]])) } : {}),
      ...(policyChanged ? { serproPolicy: { paused, reason: reason.trim() } } : {}) };
    requestFocus('saved');
    pending.current = input; setBusy(true); setError(''); setSaved('');
    try {
      const r = await api.saveCompanyAutomation(companyId, input);
      if (generation.current !== current) return;
      if (input.acompanhamentoGuias && ['enabled', 'politica', 'limiteConsultas'].some(key => r?.acompanhamentoGuias?.[key] !== input.acompanhamentoGuias[key])) throw new Error('Não foi possível confirmar o acompanhamento salvo. A intenção foi preservada; confira o resultado antes de continuar.');
      if (input.envioGuias && r?.envioGuias?.enabled !== input.envioGuias.enabled) throw new Error('Não foi possível confirmar o envio automático salvo. Recarregue para conferir.');
      if (input.lembretes && r?.lembretes?.enabled !== input.lembretes.enabled) throw new Error('Não foi possível confirmar os lembretes salvos. Recarregue para conferir.');
      if (input.cicloSimples && (r?.cicloSimples?.enabled !== input.cicloSimples.enabled || JSON.stringify([...(r?.cicloSimples?.fontes || [])].sort()) !== JSON.stringify([...input.cicloSimples.fontes].sort()))) throw new Error('Não foi possível confirmar as fontes salvas. Recarregue para conferir.');
      if (input.automationPolicy && (r?.automationPolicy?.paused !== input.automationPolicy.paused || !r.automationPolicy.updatedAt || !r.automationPolicy.updatedBy)) throw new Error('Não foi possível confirmar a pausa empresarial salva. Recarregue para conferir.');
      if (!r || r.ok === false || !r.revision || !Array.isArray(r.rotinas) || (r.companyId && r.companyId !== companyId)) throw new Error('Não foi possível confirmar a configuração desta empresa. Recarregue para conferir.');
      setData(r); setValues(Object.fromEntries(r.rotinas.map(x => [x.key, x.enabled]))); pending.current = null; setPreview(false);
      setPaused(r.serproPolicy?.paused === true); setReason(''); setReminders(r.lembretes?.enabled === true); setTracking(r.acompanhamentoGuias?.enabled === true); setEnvioGuias(r.envioGuias?.enabled === true);
      setSaved('Configuração salva. Nenhuma consulta ou mensagem foi iniciada agora.');
      setCicloSimples({ enabled: r.cicloSimples?.enabled === true, fontes: r.cicloSimples?.fontes || [] });
      setAutomationPaused(r.automationPolicy?.paused === true); setAutomationReason('');
    } catch (e) { if (generation.current === current) {
      setError(e.message || 'Não foi possível confirmar o salvamento. Confira a configuração antes de continuar.');
      if ([403, 409, 422].includes(e.status)) setReloadRequired(true);
    } }
    finally { if (generation.current === current) setBusy(false); }
  }
  return <section className="operacoes" aria-label="Automação da empresa">
    <h2 ref={headingRef} tabIndex={-1}>Automação</h2>
    <p>Configure os lembretes de guias e as consultas automáticas desta empresa.</p>
    {error && <p role="alert" ref={errorRef} tabIndex={-1}>{error} <Button variant="secondary" onClick={load} disabled={busy}>Recarregar configuração</Button></p>}
    {saved && <p role="status" ref={savedRef} tabIndex={-1}>{saved}</p>}
    {!data && !error && <p role="status">Carregando configuração…</p>}
    {data && <>
      <section className="operacoes-previa" aria-label="Pausa das automações" style={{ marginBlock: 20 }}>
        <h3>Ciclo fiscal e guias</h3>
        <p>{!data.automationPolicy || !data.globalAutomationPolicy ? 'Estado das pausas indisponível. Recarregue para conferir.'
          : data.globalAutomationPolicy.paused ? 'Automações bloqueadas pela pausa geral.'
            : data.automationPolicy.paused ? 'Automações pausadas nesta empresa.' : 'Sem pausa: execução depende das seleções e agendas salvas.'}</p>
        <label className="operacoes-rotina">
          <input type="checkbox" checked={automationPaused} disabled={locked || !data.automationPolicy || !data.globalAutomationPolicy}
            onChange={e => { setAutomationPaused(e.target.checked); setAutomationReason(''); setSaved(''); }} />
          <span>Pausar automações desta empresa</span>
        </label>
        <p>Captura ADN, rotinas fiscais, consulta de pagamento e lembretes. Retomar preserva seleções, agendas e a pausa geral; horários anteriores não são recuperados automaticamente. Ações manuais mantêm suas próprias travas.</p>
        {data.automationPolicy?.updatedAt && <p>Última alteração: {new Date(data.automationPolicy.updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · Brasília · {data.automationPolicy.updatedBy}. Motivo: {data.automationPolicy.reason}</p>}
        {data.globalAutomationPolicy?.reason && <p>Pausa geral: {data.globalAutomationPolicy.paused ? 'pausada' : 'retomada'} · {data.globalAutomationPolicy.reason} · {data.globalAutomationPolicy.actor?.name || data.globalAutomationPolicy.actor?.id} · {new Date(data.globalAutomationPolicy.changedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · Brasília.</p>}
        {automationChanged && <label style={{ display: 'grid', gap: 8 }}>Motivo da alteração das automações
          <textarea value={automationReason} maxLength={300} rows={2} disabled={locked} onChange={e => setAutomationReason(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', font: 'inherit' }} />
        </label>}
      </section>
      <section className="operacoes-previa" aria-label="Coleta e cálculo do Simples" style={{ marginBlock: 20 }}>
        <h3>Coleta e cálculo do Simples</h3>
        {!cicloApplicable && <p>O cadastro atual não confirma Simples Nacional. A seleção salva é preservada: o histórico fiscal determina se uma competência passada pode executar. Você pode desativar a seleção; nova ativação e alteração das fontes exigem conferência do cadastro atual.</p>}
          <label className="operacoes-rotina"><input type="checkbox" checked={cicloSimples.enabled} disabled={locked || !data.cicloSimples || (!cicloApplicable && !data.cicloSimples.enabled)} onChange={e => { setCicloSimples(v => ({ ...v, enabled: e.target.checked })); setSaved(''); }} /><span>Selecionar empresa para coleta e cálculo</span></label>
          {!data.cicloSimples && <p>Configuração indisponível. Recarregue antes de alterar.</p>}
          <fieldset disabled={locked || !data.cicloSimples || !cicloApplicable}><legend>Fontes de notas</legend>{[['NFE', 'NF-e'], ['NFSE', 'NFS-e']].map(([key, label]) => <label className="operacoes-rotina" key={key}><input type="checkbox" checked={cicloSimples.fontes.includes(key)} onChange={e => { setCicloSimples(v => ({ ...v, fontes: e.target.checked ? [...v.fontes, key] : v.fontes.filter(f => f !== key) })); setSaved(''); }} /><span>{label}</span></label>)}</fieldset>
          {cicloInvalid && <p role="alert">Selecione ao menos uma fonte para ativar.</p>}
          <p>Coleta matinal do dia 1 ao dia 8. Após a coleta final completa, um cálculo por revisão fica aguardando conferência do contador. Dados incompletos ou erros exigem revisão; não há transmissão nesta etapa.</p>
          <p>Agenda compartilhada em Rotinas → Configuração. Selecionar esta empresa não liga a agenda nem remove as pausas.</p>
      </section>
      <section className="operacoes-previa" aria-label="Envio automático de guias" style={{ marginBlock: 20 }}>
        <h3>Envio automático de guias</h3>
        <label className="operacoes-rotina"><input type="checkbox" checked={envioGuias} disabled={locked || !data.envioGuias || (!data.envioGuias.applicableCurrentRegime && !data.envioGuias.enabled)} onChange={e => { setEnvioGuias(e.target.checked); setSaved(''); }} /><span>Selecionar empresa para envio automático de guias</span></label>
        {!data.envioGuias && <p>Configuração indisponível. Recarregue antes de alterar.</p>}
        <p>Envia quando as guias esperadas estão disponíveis. No dia 13, antecipado ao dia útil anterior, envia as válidas e registra as faltantes. Guias com vencimento anterior podem sair dois dias úteis antes.</p>
        <p>A agenda é independente em Rotinas → Configuração. Salvar não envia documentos nem ativa a agenda. Pausas gerais e desta empresa continuam valendo; erros e resultados incertos exigem conferência.</p>
      </section>
      <section className="operacoes-previa" aria-label="Lembretes de guias" style={{ marginBlock: 20 }}>
        <h3>Lembretes de guias</h3>
        <label className="operacoes-rotina">
          <input type="checkbox" checked={reminders} disabled={locked || !data.lembretes} onChange={e => { setReminders(e.target.checked); setSaved(''); }} />
          <span>Selecionar empresa para lembretes no WhatsApp</span>
        </label>
        <label className="operacoes-rotina"><input type="checkbox" checked={tracking} disabled={locked || !data.acompanhamentoGuias} onChange={e => { setTracking(e.target.checked); setSaved(''); }} /><span>Adotar acompanhamento em dois dias úteis</span></label>
        <p>{tracking ? 'Confirmação dois dias úteis antes e no dia de comunicação do vencimento. Dois dias úteis depois, uma consulta fiscal por guia ainda não confirmada nem recalculada e oferta de atualização quando elegível.' : data.acompanhamentoGuias?.politica ? 'Novo acompanhamento desligado nesta empresa.' : 'Fluxo anterior: um dia útil antes, no dia útil do vencimento e um dia útil depois.'} O vencimento nominal do documento é preservado.</p>
        <p>O novo acompanhamento autoriza no máximo uma consulta automática por guia, sujeita aos limites e custos SERPRO existentes. Falha ou resultado inconclusivo exige conferência, sem repetição. A adesão não seleciona a empresa para WhatsApp nem liga a agenda global.</p>
        <p>{!data.lembretes ? 'Configuração de lembretes indisponível. Recarregue antes de alterar.' : data.lembretes.agenda?.enabled
          ? `Agenda global: diariamente às ${String(data.lembretes.agenda.hour).padStart(2, '0')}:00 · Brasília.`
          : 'Agenda global desligada ou incompleta. Selecionar esta empresa não ativa a agenda.'}</p>
        <p>Horário em Rotinas → Configuração → Agenda. O envio exige guia válida, entrega comprovada e contato autorizado; pagamento confirmado e débito automático impedem lembretes incompatíveis.</p>
      </section>
      {data.regime && <p>Regime: {({ SIMPLES: 'Simples Nacional', LUCRO_PRESUMIDO: 'Lucro Presumido', LUCRO_REAL: 'Lucro Real' })[data.regime] || data.regime}</p>}
      {data.unavailableReason && <p role="alert">{data.unavailableReason}</p>}
      <div className="operacoes-lista">{data.rotinas.filter(r => r.applicable !== false).map(r => <label className="operacoes-rotina" key={r.key}>
        <input type="checkbox" checked={values[r.key] === true} disabled={locked} onChange={e => { setSaved(''); setValues(v => ({ ...v, [r.key]: e.target.checked })); }} />
        <span><strong>{r.label}</strong><small>{r.agenda?.enabled && r.agenda.hour != null && r.agenda.day != null
          ? `${r.agenda.frequency === 'DAILY' ? 'Diariamente' : `Dia ${r.agenda.day}`} às ${String(r.agenda.hour).padStart(2, '0')}:00 · Brasília`
          : 'Agenda da rotina não habilitada ou incompleta'}</small></span>
      </label>)}</div>
      <p>Ativar não dispensa procuração válida nem os limites da integração. Documentos já disponíveis continuam sendo reaproveitados pelas rotinas atuais.</p>
      {data.serproPolicy && <section className="operacoes-previa" aria-label="Pausa SERPRO" style={{ marginBlock: 20 }}>
        <label className="operacoes-rotina">
          <input type="checkbox" checked={paused} disabled={locked} onChange={e => { setPaused(e.target.checked); setReason(''); setSaved(''); }} />
          <span>Pausar operações SERPRO</span>
        </label>
        <p>Bloqueia novas consultas e transmissões integradas, manuais e automáticas. Documentos locais continuam disponíveis. Chamadas já autorizadas podem concluir.</p>
        {data.serproPolicy.reason && <p>Último motivo registrado: {data.serproPolicy.reason}</p>}
        {policyChanged && <label style={{ display: 'grid', gap: 8 }}>
          Motivo da {paused ? 'pausa' : 'retomada'}
          <textarea value={reason} maxLength={300} rows={2} disabled={locked} onChange={e => setReason(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', font: 'inherit' }} />
        </label>}
      </section>}
      {!canEdit ? <p>Seu acesso permite visualizar esta configuração.</p> : preview ? <div className="operacoes-previa">
        <h3 ref={previewRef} tabIndex={-1}>Conferir alteração</h3>
        {automationChanged && <p>{automationPaused ? 'Pausar automações desta empresa.' : 'Retomar automações desta empresa conforme pausa geral, seleções e agendas salvas.'} Motivo: {automationReason.trim()}</p>}
        {envioChanged && <p>Envio automático de guias: {envioGuias ? 'selecionar esta empresa' : 'desativar nesta empresa'}. A agenda global permanece como está.</p>}
        {trackingChanged && <p>Acompanhamento em dois dias úteis: {tracking ? 'adotar contrato com limite de uma consulta automática por guia' : 'desativar nesta empresa'}. Seleção WhatsApp, agenda global e pausas permanecem independentes.</p>}
        {remindersChanged && <p>Lembretes de guias: {reminders ? 'selecionar esta empresa' : 'desativar nesta empresa'}. A agenda global permanece como está.</p>}
        {cicloChanged && <p>Coleta e cálculo: {cicloSimples.enabled ? 'selecionar esta empresa' : 'desativar nesta empresa'}. Fontes: {cicloSimples.fontes.map(f => f === 'NFE' ? 'NF-e' : 'NFS-e').join(', ') || 'nenhuma'}. A agenda global permanece como está.</p>}
        <ul>{changes.map(r => <li key={r.key}>{r.label}: {values[r.key] ? 'ativar nesta empresa' : 'desativar nesta empresa'}</li>)}</ul>
        {policyChanged && <><p>{paused ? 'Pausar novas consultas e transmissões SERPRO desta empresa.' : 'Retomar operações SERPRO conforme permissões, procurações e rotinas habilitadas.'}</p><p>Motivo: {reason.trim()}</p></>}
        <p>Salvar não envia mensagens, executa consultas ou altera o fechamento. Uma operação já iniciada pode terminar.</p>
        <Button onClick={save} disabled={busy || reloadRequired}>{busy ? 'Salvando…' : 'Salvar configuração'}</Button>{' '}
        <Button variant="secondary" disabled={busy || !!pending.current} onClick={() => { requestFocus('review'); setPreview(false); }}>Voltar à edição</Button>
      </div> : <Button ref={reviewRef} disabled={busy || reloadRequired || !hasChanges || cicloInvalid || (policyChanged && !reason.trim()) || (automationChanged && !automationReason.trim())} onClick={() => { requestFocus('preview'); setPreview(true); }}>Conferir alterações</Button>}
      {api?.getCompanyGuideTracking && <CompanyGuideTracking key={companyId} api={api} companyId={companyId} />}
      {api?.getCompanyGuideDelivery && <CompanyGuideDelivery api={api} companyId={companyId} />}
      {(data.cicloSimples || data.regime === 'SIMPLES') && <CompanySimplesCycle key={companyId} api={api} companyId={companyId} canEdit={canEdit} configurationPending={hasChanges || busy} />}
    </>}
    <CompanyManualInss key={companyId} api={api} companyId={companyId} canEdit={canEdit} />
  </section>;
}
