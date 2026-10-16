import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useEdicaoPendente } from '../configuracoes/ProtecaoEdicao';
import './operacoes.css';
import { CompanyManualInss } from './OperationsManualInss';

export function CompanyAutomation({ api, companyId, canEdit }) {
  const [data, setData] = useState(null), [values, setValues] = useState({});
  const [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState(false);
  const [paused, setPaused] = useState(false), [reason, setReason] = useState('');
  const [reloadRequired, setReloadRequired] = useState(false);
  const generation = useRef(0), pending = useRef(null);
  const changes = (data?.rotinas || []).filter(r => r.applicable !== false && values[r.key] !== r.enabled);
  const policyChanged = paused !== (data?.serproPolicy?.paused === true);
  const hasChanges = changes.length > 0 || policyChanged;
  const locked = !canEdit || busy || preview || !!pending.current || reloadRequired;
  useEdicaoPendente(hasChanges);
  async function load() {
    const current = ++generation.current;
    setBusy(true); setError(''); setPreview(false); setData(null); setReloadRequired(false);
    try {
      if (!api.getCompanyAutomation) throw new Error('Configuração disponível somente com a API conectada.');
      const r = await api.getCompanyAutomation(companyId);
      if (generation.current !== current) return;
      setData(r); setValues(Object.fromEntries(r.rotinas.map(x => [x.key, x.enabled]))); pending.current = null;
      setPaused(r.serproPolicy?.paused === true); setReason('');
    } catch (e) { if (generation.current === current) setError(e.message || 'Não foi possível carregar a configuração.'); }
    finally { if (generation.current === current) setBusy(false); }
  }
  useEffect(() => { setData(null); setSaved(''); load(); return () => { generation.current++; }; }, [companyId, api]);
  async function save() {
    if (!canEdit || busy || reloadRequired || !preview || !hasChanges || (policyChanged && !reason.trim())) return;
    const current = generation.current;
    const input = pending.current || { expectedRevision: data.revision, requestId: crypto.randomUUID(),
      ...(changes.length ? { rotinas: Object.fromEntries(changes.map(r => [r.key, values[r.key]])) } : {}),
      ...(policyChanged ? { serproPolicy: { paused, reason: reason.trim() } } : {}) };
    pending.current = input; setBusy(true); setError(''); setSaved('');
    try {
      const r = await api.saveCompanyAutomation(companyId, input);
      if (generation.current !== current) return;
      setData(r); setValues(Object.fromEntries(r.rotinas.map(x => [x.key, x.enabled]))); pending.current = null; setPreview(false);
      setPaused(r.serproPolicy?.paused === true); setReason('');
      setSaved('Configuração salva. Nenhuma consulta foi iniciada agora.');
    } catch (e) { if (generation.current === current) {
      setError(e.message || 'Não foi possível confirmar o salvamento. Confira a configuração antes de continuar.');
      if ([403, 409, 422].includes(e.status)) setReloadRequired(true);
    } }
    finally { if (generation.current === current) setBusy(false); }
  }
  return <section className="operacoes" aria-label="Automação da empresa">
    <h2>Automação</h2>
    <p>Escolha as consultas automáticas desta empresa. Os horários e as condições das rotinas existentes continuam valendo.</p>
    {error && <p role="alert">{error} <Button variant="secondary" onClick={load} disabled={busy}>Recarregar configuração</Button></p>}
    {saved && <p role="status">{saved}</p>}
    {!data && !error && <p role="status">Carregando configuração…</p>}
    {data && <>
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
        <h3>Conferir alteração</h3>
        <ul>{changes.map(r => <li key={r.key}>{r.label}: {values[r.key] ? 'ativar nesta empresa' : 'desativar nesta empresa'}</li>)}</ul>
        {policyChanged && <><p>{paused ? 'Pausar novas consultas e transmissões SERPRO desta empresa.' : 'Retomar operações SERPRO conforme permissões, procurações e rotinas habilitadas.'}</p><p>Motivo: {reason.trim()}</p></>}
        <p>Salvar não executa consultas nem altera o fechamento. Uma operação já iniciada pode terminar.</p>
        <Button onClick={save} disabled={busy || reloadRequired}>{busy ? 'Salvando…' : 'Salvar configuração'}</Button>{' '}
        <Button variant="secondary" disabled={busy || !!pending.current} onClick={() => setPreview(false)}>Voltar à edição</Button>
      </div> : <Button disabled={busy || reloadRequired || !hasChanges || (policyChanged && !reason.trim())} onClick={() => setPreview(true)}>Conferir alterações</Button>}
    </>}
    <CompanyManualInss key={companyId} api={api} companyId={companyId} canEdit={canEdit} />
  </section>;
}
