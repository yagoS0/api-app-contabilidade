import { operationInstant } from './operationsDetails';
import { previousInssMonth } from './OperationsManualInss.shared.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { useEdicaoPendente } from '../configuracoes/ProtecaoEdicao.shared.js';
import { dataCivilBR } from '../../lib/dataCivil';
import { useWorkspaceEditor } from '../../app/navigation/WorkspaceNavigation.shared';

const statuses = { DOCUMENT_ABSENT: 'Ausência de guia confirmada nesta competência', NOT_APPLICABLE: 'Não se aplica nesta competência', PENDING_DOCUMENT: 'Aguardando guia manual', DOCUMENT_REVIEW: 'Guia precisa de revisão', DOCUMENT_AVAILABLE: 'Guia disponível' };
const empty = { applicable: null, responsible: '', dueDate: null, note: '', reason: '' };
const fieldStyle = { display: 'grid', gap: 6, minWidth: 0 };
const controlStyle = { width: '100%', boxSizing: 'border-box', minHeight: 40, font: 'inherit', color: 'var(--text)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 };


// Only local records: mounting this editor never queries or generates a fiscal document.
export function OperationsManualInss({ api, companyId, competencia, canEdit = false, onPendingChange, compact = false }) {
  const [data, setData] = useState(null), [form, setForm] = useState(empty);
  const [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState(false), [reloadRequired, setReloadRequired] = useState(false);
  const generation = useRef(0), pending = useRef(null), saving = useRef(false);
  const dirty = Boolean(data && JSON.stringify(form) !== JSON.stringify(data.state));
  // This consumer knows its command state; do not infer it from every legacy boolean.
  const context = useMemo(() => ({ api, companyId, competencia }), [api, companyId, competencia]);
  const workspace = useWorkspaceEditor({
    context,
    get kind() { return pending.current ? 'operation' : 'legacy'; },
    get dirty() { return dirty || Boolean(pending.current); },
    // Pending commands must be resolved in this editor with the existing requestId.
    // No save/discard callback claims to cancel or acknowledge an in-flight command.
  });
  // Preserve the older confirmation contract when mounted outside the workspace.
  useEdicaoPendente(workspace ? false : dirty || Boolean(pending.current));
  useEffect(() => { onPendingChange?.(dirty || busy); return () => onPendingChange?.(false); }, [dirty, busy, onPendingChange]);
  const reasonRequired = form.applicable !== null || (data?.state.applicable != null && form.applicable !== data.state.applicable);
  const locked = !canEdit || busy || preview || reloadRequired || Boolean(pending.current);
  const load = useCallback(async () => {
    if (saving.current) return;
    const current = ++generation.current;
    setBusy(true); setData(null); setError(''); setSaved(''); setPreview(false); setReloadRequired(false); pending.current = null;
    try {
      if (!api?.getCompanyManualInss) throw Error('Controle de INSS indisponível nesta conexão.');
      const result = await api.getCompanyManualInss(companyId, competencia);
      if (current !== generation.current) return;
      if (!result?.state || !result.revision || !statuses[result.status]) throw Error('Não foi possível ler o controle de INSS.');
      setData(result); setForm({ ...result.state });
    } catch (e) { if (current === generation.current) setError(e.message || 'Não foi possível carregar o controle de INSS.'); }
    finally { if (current === generation.current) setBusy(false); }
  }, [api, companyId, competencia]);
  useEffect(() => { const generationDaExecucao = generation; saving.current = false; load(); return () => { generationDaExecucao.current++; }; }, [load, api, companyId, competencia]);
  async function save() {
    if (!canEdit || busy || saving.current || reloadRequired || !preview || !dirty || (reasonRequired && !form.reason.trim())) return;
    const current = generation.current;
    const input = pending.current || { expectedRevision: data.revision, requestId: crypto.randomUUID(), state: { ...form, responsible: form.responsible.trim(), note: form.note.trim(), reason: form.reason.trim() } };
    pending.current = input; saving.current = true; setBusy(true); setError(''); setSaved('');
    try {
      const result = await api.saveCompanyManualInss(companyId, competencia, input);
      if (current !== generation.current) return;
      if (!result?.state || !result.revision || !statuses[result.status]) throw Error('O retorno do salvamento não foi confirmado.');
      setData(result); setForm({ ...result.state }); pending.current = null; setPreview(false); setSaved('Controle salvo. Nenhuma guia foi gerada ou enviada.');
    } catch (e) { if (current === generation.current) {
      const refused = [400, 403, 404, 409, 422].includes(e.status);
      setReloadRequired(refused);
      setError(refused ? (e.message || 'Não foi possível salvar. Recarregue o registro antes de continuar.') : 'Não foi possível confirmar o salvamento. Tente novamente para conferir a mesma solicitação.');
    } } finally { if (current === generation.current) { saving.current = false; setBusy(false); } }
  }
  function edit(key, value) { setSaved(''); setForm(v => ({ ...v, [key]: value })); }
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const overdue = data?.state.dueDate && data.state.dueDate < today && ['PENDING_DOCUMENT', 'DOCUMENT_REVIEW'].includes(data.status);
  if (compact) return <section className="operacoes-inss-detalhe" aria-label="Controle de INSS manual">
    {busy && !data && <p role="status">Carregando controle de INSS…</p>}
    {error && <div role="alert"><p>{error}</p><Button variant="secondary" disabled={busy} onClick={load}>Recarregar controle</Button></div>}
    {data && <>
      <div className="operacoes-inss-situacao">
        <span className="operacoes-inss-label">Documento</span>
        <strong role="status">{statuses[data.status]}</strong>
        {data.status === 'DOCUMENT_REVIEW' && <p role="alert">Confira a classificação e o documento antes de liberar ao cliente.</p>}
        {[...new Set((data.guides || []).map(g => g.reviewReason).filter(Boolean))].map(reason => <p key={reason}>{reason}</p>)}
      </div>
      {data.absence && <p>Declarada na aba Guias{data.absence.at ? ` em ${operationInstant(data.absence.at)}` : ''}.{data.absence.reason ? ` Motivo: ${data.absence.reason}` : ''}</p>}
      <dl className="operacoes-inss-dados">
        <div><dt>Responsável</dt><dd>{data.state.responsible || 'Não definido'}</dd></div>
        <div><dt>Prazo operacional</dt><dd>{dataCivilBR(data.state.dueDate) || 'Não definido'}</dd>{overdue && <span className="operacoes-erro" role="alert">Prazo operacional vencido</span>}</div>
      </dl>
      {(data.state.note || data.state.reason) && <div className="operacoes-inss-observacoes">
        {data.state.note && <><span className="operacoes-inss-label">Observação</span><p>{data.state.note}</p></>}
        {data.state.reason && <><span className="operacoes-inss-label">Motivo da exceção</span><p>{data.state.reason}</p></>}
      </div>}
      <p className="operacoes-inss-origem">{data.applicabilitySource === 'month' ? 'Aplicação definida para esta competência.' : `Conforme cadastro da empresa · ${data.hasProlabore ? 'com' : 'sem'} pró-labore.`}</p>
    </>}
  </section>;
  return <section className="operacoes operacoes-inss-manual" aria-label="Controle de INSS manual" style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
    {busy && !data && <p role="status">Carregando controle de INSS…</p>}
    {error && <div role="alert"><p>{error}</p>{(!pending.current || reloadRequired) && <Button variant="secondary" disabled={busy} onClick={load}>Recarregar controle</Button>}</div>}
    {saved && <p role="status">{saved}</p>}
    {data && <>
      <p role="status">{statuses[data.status]}{data.guides?.some(g => g.status !== 'VAZIO') ? ` · ${data.guides.filter(g => g.status !== 'VAZIO').length} guia(s) registrada(s)` : ''}</p>
      {data.absence && <p>Declarada na aba Guias{data.absence.at ? ` em ${operationInstant(data.absence.at)}` : ''}.{data.absence.reason ? ` Motivo: ${data.absence.reason}` : ''}</p>}
      <p>Pró-labore no cadastro: {data.hasProlabore ? 'sim' : 'não'}. {data.applicabilitySource === 'month' ? 'Exceção desta competência.' : 'Aplicação conforme cadastro.'}</p>
      {overdue && <p role="alert">Prazo operacional vencido em {dataCivilBR(data.state.dueDate)}.</p>}
      {data.status === 'DOCUMENT_REVIEW' && <p role="alert">Confira a guia e sua classificação na aba Guias antes de liberá-la ao cliente.</p>}
      {data.guides?.filter(g => g.reviewReason).map(g => <p key={g.id}>{g.reviewReason}</p>)}
      {compact ? <div>
        <p>Responsável: {data.state.responsible || 'não definido'} · Prazo operacional: {dataCivilBR(data.state.dueDate) || 'não definido'}.</p>
        {data.state.note && <p>{data.state.note}</p>}{data.state.reason && <p>Motivo: {data.state.reason}</p>}
      </div> : <>
      <label style={fieldStyle}>Aplicação nesta competência<select style={controlStyle} disabled={locked} value={form.applicable === null ? '' : String(form.applicable)} onChange={e => edit('applicable', e.target.value === '' ? null : e.target.value === 'true')}>
        <option value="">Usar cadastro da empresa</option><option value="true">INSS necessário</option><option value="false">Não se aplica</option>
      </select></label>
      <label style={fieldStyle}>Responsável<input style={controlStyle} disabled={locked} maxLength={120} value={form.responsible} onChange={e => edit('responsible', e.target.value)} /></label>
      <label style={fieldStyle}>Prazo operacional<input style={controlStyle} type="date" disabled={locked} value={form.dueDate || ''} onChange={e => edit('dueDate', e.target.value || null)} /></label>
      <label style={fieldStyle}>Observação<textarea style={controlStyle} rows={2} maxLength={2000} disabled={locked} value={form.note} onChange={e => edit('note', e.target.value)} /></label>
      {(reasonRequired || form.reason) && <label style={fieldStyle}>Motivo da exceção ou retorno ao cadastro<textarea style={controlStyle} rows={2} maxLength={500} disabled={locked} value={form.reason} onChange={e => edit('reason', e.target.value)} /></label>}
      {canEdit && (preview ? <div className="operacoes-previa">
        <h3>Conferir controle de INSS</h3>
        <p>Competência: {competencia}. Aplicação: {form.applicable === null ? 'cadastro da empresa' : form.applicable ? 'INSS necessário' : 'não se aplica'}.</p>
        <p>Responsável: {form.responsible.trim() || 'não definido'} · Prazo operacional: {dataCivilBR(form.dueDate) || 'não definido'}.</p>
        {form.note && <p>Observação: {form.note}</p>}{form.reason && <p>Motivo: {form.reason}</p>}
        <p>Salva apenas este controle. Não gera, transmite ou envia guias e não confirma pagamento.</p>
        <div className="operacoes-acoes"><Button disabled={busy || reloadRequired} onClick={save}>{busy ? 'Salvando…' : pending.current ? 'Conferir salvamento' : 'Salvar controle'}</Button><Button variant="secondary" disabled={busy || Boolean(pending.current)} onClick={() => setPreview(false)}>Voltar à edição</Button></div>
      </div> : <Button disabled={busy || !dirty || reloadRequired || (reasonRequired && !form.reason.trim())} onClick={() => setPreview(true)}>Conferir controle</Button>)}
      {!canEdit && <p>Seu acesso permite apenas visualizar o controle.</p>}
      {canEdit && dirty && !preview && <Button variant="secondary" disabled={busy} onClick={load}>Descartar alterações</Button>}
      </>}
      <InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(companyId, 'guides')}?competencia=${encodeURIComponent(competencia)}`}>Abrir Guias para anexar ou revisar o INSS</InternalLink>
    </>}
  </section>;
}

export function CompanyManualInss({ api, companyId, canEdit }) {
  const [opened, setOpened] = useState(false), [editing, setEditing] = useState(false), [competencia, setCompetencia] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('competencia');
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(requested || '') ? requested : previousInssMonth();
  });
  return <details style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }} onToggle={e => { if (e.currentTarget.open) setOpened(true); }}>
    <summary style={{ cursor: 'pointer', minHeight: 44 }}>INSS manual por competência</summary>
    {opened && <><label style={{ ...fieldStyle, maxWidth: 220, marginBlock: 12 }}>Competência do INSS<input type="month" disabled={editing} value={competencia} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setCompetencia(e.target.value); }} /></label><OperationsManualInss key={`${companyId}:${competencia}`} api={api} companyId={companyId} competencia={competencia} canEdit={canEdit} onPendingChange={setEditing} /></>}
  </details>;
}


