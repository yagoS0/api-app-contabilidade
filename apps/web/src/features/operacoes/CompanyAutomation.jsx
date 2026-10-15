import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useEdicaoPendente } from '../configuracoes/ProtecaoEdicao';
import './operacoes.css';

export function CompanyAutomation({ api, companyId, canEdit }) {
  const [data, setData] = useState(null), [values, setValues] = useState({});
  const [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState(false);
  const generation = useRef(0), pending = useRef(null);
  const changes = (data?.rotinas || []).filter(r => values[r.key] !== r.enabled);
  useEdicaoPendente(changes.length > 0);
  async function load() {
    const current = ++generation.current;
    setBusy(true); setError(''); setPreview(false);
    try {
      if (!api.getCompanyAutomation) throw new Error('Configuração disponível somente com a API conectada.');
      const r = await api.getCompanyAutomation(companyId);
      if (generation.current !== current) return;
      setData(r); setValues(Object.fromEntries(r.rotinas.map(x => [x.key, x.enabled]))); pending.current = null;
    } catch (e) { if (generation.current === current) setError(e.message || 'Não foi possível carregar a configuração.'); }
    finally { if (generation.current === current) setBusy(false); }
  }
  useEffect(() => { setData(null); setSaved(''); load(); return () => { generation.current++; }; }, [companyId, api]);
  async function save() {
    const current = generation.current;
    const input = pending.current || { expectedRevision: data.revision, requestId: crypto.randomUUID(), rotinas: Object.fromEntries(changes.map(r => [r.key, values[r.key]])) };
    pending.current = input; setBusy(true); setError(''); setSaved('');
    try {
      const r = await api.saveCompanyAutomation(companyId, input);
      if (generation.current !== current) return;
      setData(r); setValues(Object.fromEntries(r.rotinas.map(x => [x.key, x.enabled]))); pending.current = null; setPreview(false);
      setSaved('Configuração salva. As rotinas seguem os horários já configurados; nenhuma consulta foi iniciada agora.');
    } catch (e) { if (generation.current === current) setError(e.message || 'Não foi possível confirmar o salvamento. Confira a configuração antes de continuar.'); }
    finally { if (generation.current === current) setBusy(false); }
  }
  return <section className="operacoes" aria-label="Automação da empresa">
    <h2>Automação</h2>
    <p>Escolha as consultas automáticas desta empresa. Os horários e as condições das rotinas existentes continuam valendo.</p>
    {error && <p role="alert">{error} <Button variant="secondary" onClick={load} disabled={busy}>Recarregar configuração</Button></p>}
    {saved && <p role="status">{saved}</p>}
    {!data && !error && <p role="status">Carregando configuração…</p>}
    {data && <>
      <div className="operacoes-lista">{data.rotinas.map(r => <label className="operacoes-rotina" key={r.key}>
        <input type="checkbox" checked={values[r.key] === true} disabled={!canEdit || busy || preview || !!pending.current} onChange={e => { setSaved(''); setValues(v => ({ ...v, [r.key]: e.target.checked })); }} />
        <span><strong>{r.label}</strong><small>{r.agenda?.enabled && r.agenda.hour != null && r.agenda.day != null
          ? `${r.agenda.frequency === 'DAILY' ? 'Diariamente' : `Dia ${r.agenda.day}`} às ${String(r.agenda.hour).padStart(2, '0')}:00 · Brasília`
          : 'Agenda da rotina não habilitada ou incompleta'}</small></span>
      </label>)}</div>
      <p>Ativar não dispensa procuração válida nem os limites da integração. Documentos já disponíveis continuam sendo reaproveitados pelas rotinas atuais.</p>
      {!canEdit ? <p>Seu acesso permite visualizar esta configuração.</p> : preview ? <div className="operacoes-previa">
        <h3>Conferir alteração</h3>
        <ul>{changes.map(r => <li key={r.key}>{r.label}: {values[r.key] ? 'ativar nesta empresa' : 'desativar nesta empresa'}</li>)}</ul>
        <p>Salvar não executa consultas nem altera o fechamento. Uma operação já iniciada pode terminar.</p>
        <Button onClick={save} disabled={busy}>{busy ? 'Salvando…' : 'Salvar configuração'}</Button>{' '}
        <Button variant="secondary" disabled={busy || !!pending.current} onClick={() => setPreview(false)}>Voltar à edição</Button>
      </div> : <Button disabled={busy || !changes.length} onClick={() => setPreview(true)}>Conferir alterações</Button>}
    </>}
  </section>;
}
