import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useEdicaoPendente } from '../configuracoes/ProtecaoEdicao.shared.js';
import './operacoes.css';
import { CompanyManualInss } from './OperationsManualInss';

export function CompanyAutomation({ api, companyId, canEdit }) {
  const [data, setData] = useState(null), [values, setValues] = useState({});
  const [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState(false);
  const [paused, setPaused] = useState(false), [reason, setReason] = useState('');
  const [automationPaused, setAutomationPaused] = useState(false), [automationReason, setAutomationReason] = useState('');
  const [reminders, setReminders] = useState(false);
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
  const remindersChanged = reminders !== (data?.lembretes?.enabled === true);
  const hasChanges = !!data && (changes.length > 0 || policyChanged || remindersChanged || automationChanged);
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
      setPaused(r.serproPolicy?.paused === true); setReason(''); setReminders(r.lembretes?.enabled === true);
      setAutomationPaused(r.automationPolicy?.paused === true); setAutomationReason('');
    } catch (e) { if (generation.current === current) setError(e.message || 'Não foi possível carregar a configuração.'); }
    finally { if (generation.current === current) setBusy(false); }
  }, [api, companyId]);
  useEffect(() => { const generationDaExecucao = generation; setData(null); setSaved(''); load(); return () => { generationDaExecucao.current++; }; }, [load, companyId, api]);
  async function save() {
    if (!canEdit || busy || reloadRequired || !preview || !hasChanges || (policyChanged && !reason.trim()) || (automationChanged && !automationReason.trim())) return;
    const current = generation.current;
    const input = pending.current || { expectedRevision: data.revision, requestId: crypto.randomUUID(),
      ...(automationChanged ? { automationPolicy: { paused: automationPaused, reason: automationReason.trim() } } : {}),
      ...(remindersChanged ? { lembretes: { enabled: reminders } } : {}),
      ...(changes.length ? { rotinas: Object.fromEntries(changes.map(r => [r.key, values[r.key]])) } : {}),
      ...(policyChanged ? { serproPolicy: { paused, reason: reason.trim() } } : {}) };
    requestFocus('saved');
    pending.current = input; setBusy(true); setError(''); setSaved('');
    try {
      const r = await api.saveCompanyAutomation(companyId, input);
      if (generation.current !== current) return;
      if (input.lembretes && r?.lembretes?.enabled !== input.lembretes.enabled) throw new Error('Não foi possível confirmar os lembretes salvos. Recarregue para conferir.');
      if (input.automationPolicy && (r?.automationPolicy?.paused !== input.automationPolicy.paused || !r.automationPolicy.updatedAt || !r.automationPolicy.updatedBy)) throw new Error('Não foi possível confirmar a pausa empresarial salva. Recarregue para conferir.');
      if (!r || r.ok === false || !r.revision || !Array.isArray(r.rotinas) || (r.companyId && r.companyId !== companyId)) throw new Error('Não foi possível confirmar a configuração desta empresa. Recarregue para conferir.');
      setData(r); setValues(Object.fromEntries(r.rotinas.map(x => [x.key, x.enabled]))); pending.current = null; setPreview(false);
      setPaused(r.serproPolicy?.paused === true); setReason(''); setReminders(r.lembretes?.enabled === true);
      setSaved('Configuração salva. Nenhuma consulta ou mensagem foi iniciada agora.');
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
      <section className="operacoes-previa" aria-label="Lembretes de guias" style={{ marginBlock: 20 }}>
        <h3>Lembretes de guias</h3>
        <label className="operacoes-rotina">
          <input type="checkbox" checked={reminders} disabled={locked || !data.lembretes} onChange={e => { setReminders(e.target.checked); setSaved(''); }} />
          <span>Selecionar empresa para lembretes no WhatsApp</span>
        </label>
        <p>Um dia útil antes, no dia útil do vencimento e um dia útil depois. O vencimento do documento é preservado.</p>
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
        {remindersChanged && <p>Lembretes de guias: {reminders ? 'selecionar esta empresa' : 'desativar nesta empresa'}. A agenda global permanece como está.</p>}
        <ul>{changes.map(r => <li key={r.key}>{r.label}: {values[r.key] ? 'ativar nesta empresa' : 'desativar nesta empresa'}</li>)}</ul>
        {policyChanged && <><p>{paused ? 'Pausar novas consultas e transmissões SERPRO desta empresa.' : 'Retomar operações SERPRO conforme permissões, procurações e rotinas habilitadas.'}</p><p>Motivo: {reason.trim()}</p></>}
        <p>Salvar não envia mensagens, executa consultas ou altera o fechamento. Uma operação já iniciada pode terminar.</p>
        <Button onClick={save} disabled={busy || reloadRequired}>{busy ? 'Salvando…' : 'Salvar configuração'}</Button>{' '}
        <Button variant="secondary" disabled={busy || !!pending.current} onClick={() => { requestFocus('review'); setPreview(false); }}>Voltar à edição</Button>
      </div> : <Button ref={reviewRef} disabled={busy || reloadRequired || !hasChanges || (policyChanged && !reason.trim()) || (automationChanged && !automationReason.trim())} onClick={() => { requestFocus('preview'); setPreview(true); }}>Conferir alterações</Button>}
    </>}
    <CompanyManualInss key={companyId} api={api} companyId={companyId} canEdit={canEdit} />
  </section>;
}
