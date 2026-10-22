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
  const [reminders, setReminders] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const generation = useRef(0), pending = useRef(null);
  const changes = (data?.rotinas || []).filter(r => r.applicable !== false && values[r.key] !== r.enabled);
  const policyChanged = paused !== (data?.serproPolicy?.paused === true);
  const remindersChanged = reminders !== (data?.lembretes?.enabled === true);
  const hasChanges = !!data && (changes.length > 0 || policyChanged || remindersChanged);
  const locked = !canEdit || busy || preview || !!pending.current || reloadRequired;
  useEdicaoPendente(hasChanges);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setBusy(true); setError(''); setSaved(''); setPreview(false); setData(null); setReloadRequired(false); pending.current = null;
    try {
      if (!api.getCompanyAutomation) throw new Error('Configuração disponível somente com a API conectada.');
      const r = await api.getCompanyAutomation(companyId);
      if (generation.current !== current) return;
      if (!r || r.ok === false || !r.revision || !Array.isArray(r.rotinas) || (r.companyId && r.companyId !== companyId)) throw new Error('Não foi possível confirmar a configuração desta empresa. Recarregue para conferir.');
      setData(r); setValues(Object.fromEntries(r.rotinas.map(x => [x.key, x.enabled]))); pending.current = null;
      setPaused(r.serproPolicy?.paused === true); setReason(''); setReminders(r.lembretes?.enabled === true);
    } catch (e) { if (generation.current === current) setError(e.message || 'Não foi possível carregar a configuração.'); }
    finally { if (generation.current === current) setBusy(false); }
  }, [api, companyId]);
  useEffect(() => { const generationDaExecucao = generation; setData(null); setSaved(''); load(); return () => { generationDaExecucao.current++; }; }, [load, companyId, api]);
  async function save() {
    if (!canEdit || busy || reloadRequired || !preview || !hasChanges || (policyChanged && !reason.trim())) return;
    const current = generation.current;
    const input = pending.current || { expectedRevision: data.revision, requestId: crypto.randomUUID(),
      ...(remindersChanged ? { lembretes: { enabled: reminders } } : {}),
      ...(changes.length ? { rotinas: Object.fromEntries(changes.map(r => [r.key, values[r.key]])) } : {}),
      ...(policyChanged ? { serproPolicy: { paused, reason: reason.trim() } } : {}) };
    pending.current = input; setBusy(true); setError(''); setSaved('');
    try {
      const r = await api.saveCompanyAutomation(companyId, input);
      if (generation.current !== current) return;
      if (input.lembretes && r?.lembretes?.enabled !== input.lembretes.enabled) throw new Error('Não foi possível confirmar os lembretes salvos. Recarregue para conferir.');
      if (!r || r.ok === false || !r.revision || !Array.isArray(r.rotinas) || (r.companyId && r.companyId !== companyId)) throw new Error('Não foi possível confirmar a configuração desta empresa. Recarregue para conferir.');
      setData(r); setValues(Object.fromEntries(r.rotinas.map(x => [x.key, x.enabled]))); pending.current = null; setPreview(false);
      setPaused(r.serproPolicy?.paused === true); setReason(''); setReminders(r.lembretes?.enabled === true);
      setSaved('Configuração salva. Nenhuma consulta ou mensagem foi iniciada agora.');
    } catch (e) { if (generation.current === current) {
      setError(e.message || 'Não foi possível confirmar o salvamento. Confira a configuração antes de continuar.');
      if ([403, 409, 422].includes(e.status)) setReloadRequired(true);
    } }
    finally { if (generation.current === current) setBusy(false); }
  }
  return <section className="operacoes" aria-label="Automação da empresa">
    <h2>Automação</h2>
    <p>Configure os lembretes de guias e as consultas automáticas desta empresa.</p>
    {error && <p role="alert">{error} <Button variant="secondary" onClick={load} disabled={busy}>Recarregar configuração</Button></p>}
    {saved && <p role="status">{saved}</p>}
    {!data && !error && <p role="status">Carregando configuração…</p>}
    {data && <>
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
        <h3>Conferir alteração</h3>
        {remindersChanged && <p>Lembretes de guias: {reminders ? 'selecionar esta empresa' : 'desativar nesta empresa'}. A agenda global permanece como está.</p>}
        <ul>{changes.map(r => <li key={r.key}>{r.label}: {values[r.key] ? 'ativar nesta empresa' : 'desativar nesta empresa'}</li>)}</ul>
        {policyChanged && <><p>{paused ? 'Pausar novas consultas e transmissões SERPRO desta empresa.' : 'Retomar operações SERPRO conforme permissões, procurações e rotinas habilitadas.'}</p><p>Motivo: {reason.trim()}</p></>}
        <p>Salvar não envia mensagens, executa consultas ou altera o fechamento. Uma operação já iniciada pode terminar.</p>
        <Button onClick={save} disabled={busy || reloadRequired}>{busy ? 'Salvando…' : 'Salvar configuração'}</Button>{' '}
        <Button variant="secondary" disabled={busy || !!pending.current} onClick={() => setPreview(false)}>Voltar à edição</Button>
      </div> : <Button disabled={busy || reloadRequired || !hasChanges || (policyChanged && !reason.trim())} onClick={() => setPreview(true)}>Conferir alterações</Button>}
    </>}
    <CompanyManualInss key={companyId} api={api} companyId={companyId} canEdit={canEdit} />
  </section>;
}
