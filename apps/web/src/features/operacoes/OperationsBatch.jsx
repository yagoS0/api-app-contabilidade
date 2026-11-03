import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { taskStatuses } from '../tasks/taskLabels';

const labels = { WAITING: 'Não iniciada', STARTED: 'Em processamento', ATTENTION: 'Resultado a conferir', DONE: 'Processada' };
function BatchDialog({ embedded, titulo, children, rodape, ...props }) {
  const heading = useRef(null);
  useEffect(() => { if (embedded) heading.current?.focus(); }, [embedded]);
  return embedded ? <section className="operacoes-conferencia-detalhe" aria-label={titulo}><h3 ref={heading} tabIndex={-1}>{titulo}</h3>{children}<div className="operacoes-acoes operacoes-destinos">{rodape}</div></section>
    : <Modal titulo={titulo} rodape={rodape} {...props}>{children}</Modal>;
}
export function OperationsBatch({ api, competencia, disabled = false, onChanged, embedded = false, onBusyChange, onDetailChange }) {
  const [preview, setPreview] = useState(null), [batches, setBatches] = useState([]), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(true), [confirmation, setConfirmation] = useState('');
  const [task, setTask] = useState(null), [taskError, setTaskError] = useState('');
  const context = useRef(null), pending = useRef(false), sequence = useRef(0);
  const trigger = useRef(null), wasDetail = useRef(false);
  const taskRequest = useRef(0);
  const detail = Boolean(preview || task);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { onDetailChange?.(detail); return () => onDetailChange?.(false); }, [detail, onDetailChange]);
  useEffect(() => {
    if (embedded && wasDetail.current && !detail) trigger.current?.focus();
    wasDetail.current = detail;
  }, [embedded, detail]);
  useEffect(() => {
    const origin = { api, competencia }; context.current = origin; taskRequest.current += 1;
    pending.current = false; setBusy(false); setReading(true);
    setPreview(null); setBatches([]); setError(''); setTask(null); setTaskError(''); setConfirmation('');
    void refresh(origin);
    const timer = setInterval(() => { if (!pending.current) void refresh(origin); }, 5000);
    return () => { clearInterval(timer); context.current = null; taskRequest.current += 1; };
  }, [api, competencia]);
  async function refresh(origin = context.current) {
    const version = ++sequence.current;
    try {
      const response = await api.listOperationsBatches(competencia);
      if (context.current !== origin || sequence.current !== version) return;
      if (response?.ok !== true || !Array.isArray(response.items) || response.items.some(b => b.competencia !== competencia || !Array.isArray(b.items))) throw Error('Acompanhamento indisponível.');
      setBatches(response.items);
    } catch (e) { if (context.current === origin && sequence.current === version) setError(e.message || 'Não foi possível atualizar as liberações. Os resultados anteriores foram preservados.'); }
    finally { if (context.current === origin) setReading(false); }
  }
  async function prepare(batchId = null) {
    if (pending.current) return;
    const origin = context.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await api.previewOperationsBatch(competencia, batchId);
      if (context.current !== origin) return;
      const p = response?.preview;
      if (response?.ok !== true || !p?.id || p.competencia !== competencia || !Array.isArray(p.items) || !Array.isArray(p.blocked)) throw Error('Prévia não confirmada. Atualize antes de liberar.');
      setPreview(p); setConfirmation('');
    } catch (e) { if (context.current === origin) setError(e.message || 'Não foi possível preparar a liberação.'); }
    finally { if (context.current === origin) { pending.current = false; setBusy(false); } }
  }
  async function accept() {
    if (pending.current || !preview || confirmation !== competencia) return;
    const origin = context.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await api.acceptOperationsBatch({ previewId: preview.id, requestId: crypto.randomUUID(), confirmCompetencia: competencia });
      if (context.current !== origin) return;
      if (response?.ok !== true || !response.batch?.id || response.batch.competencia !== competencia) throw Error('Aceite não confirmado. Atualize as liberações antes de qualquer nova ação.');
      setBatches(old => [response.batch, ...old.filter(b => b.id !== response.batch.id)]);
      window.dispatchEvent(new Event('background-task-changed'));
      onChanged?.();
    } catch (e) { if (context.current === origin) setError(`${e.message || 'Resposta não confirmada.'} Confira as liberações salvas e Tarefas; não repita uma tentativa iniciada.`); }
    finally {
      if (context.current === origin) { pending.current = false; setBusy(false); setPreview(null); setConfirmation(''); void refresh(origin); }
    }
  }
  function closeTask() { taskRequest.current += 1; setTask(null); setTaskError(''); }
  async function openTask(id) {
    const origin = context.current;
    const request = ++taskRequest.current;
    const current = () => context.current === origin && taskRequest.current === request;
    try {
      const response = await api.getBackgroundTask(id);
      if (!current()) return;
      if (!response?.task || response.task.jobId !== id || response.task.competencia !== competencia) throw Error('Tarefa indisponível nesta competência.');
      setTask(response.task);
      setTaskError('');
    } catch (e) { if (current()) setTaskError(e.message || 'Não foi possível consultar a tarefa.'); }
  }
  return <section className="operacoes-lote" aria-label="Liberação da rotina de transmissão">
    {!(embedded && detail) && <>
    <div className="operacoes-acoes"><Button ref={trigger} disabled={disabled || busy} onClick={() => prepare()}>{busy ? 'Conferindo liberação…' : 'Liberar rotina'}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => { setError(''); void refresh(); }}>Atualizar liberações</Button></div>
    {error && <p role="alert">{error}</p>}
    {!task && taskError && <p role="alert">{taskError}</p>}
    {reading && <p role="status">Carregando liberações…</p>}
    {!reading && !batches.length && !error && <p>Nenhuma liberação registrada nesta competência.</p>}
    {batches.map(batch => <details key={batch.id} className="operacoes-lote-resultado"><summary>Liberação de {batch.competencia} · {batch.items.length} empresa(s)</summary>
      {batch.schedulingError && <p role="alert">{batch.schedulingError}</p>}
      <ul>{batch.items.map(item => <li key={item.companyId}><strong>{item.name}</strong><span>{labels[item.state] || 'A verificar'}</span>{item.message && <p>{item.message}</p>}
        <InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(item.companyId, 'cadastroFiscal')}?competencia=${competencia}`}>Abrir apuração</InternalLink></li>)}</ul>
      <div className="operacoes-acoes">{batch.taskId && <Button variant="secondary" onClick={() => openTask(batch.taskId)}>Acompanhar tarefa</Button>}
        {batch.canResume && <Button variant="secondary" disabled={disabled || busy} onClick={() => prepare(batch.id)}>Conferir não iniciadas</Button>}</div>
    </details>)}
    </>}
    {preview && <BatchDialog embedded={embedded} titulo={preview.batchId ? 'Retomar não iniciadas' : 'Liberar rotina de transmissão'} ocupado={busy} aoFechar={() => !busy && setPreview(null)} className="operacoes-dialogo"
      rodape={<><Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancelar</Button><Button disabled={busy || disabled || !preview.items.length || confirmation !== competencia} onClick={accept}>{preview.batchId ? 'Retomar não iniciadas' : 'Liberar rotina'}</Button></>}>
      <p>Competência {competencia} · {preview.items.length} empresa(s) elegível(is) · {preview.blocked.length} bloqueada(s).</p>
      <p>O servidor confere todas as empresas do seu acesso. Esta liberação transmite as apurações confirmadas da prévia e pode consultar documentos faltantes, com custo externo. Confirmações posteriores ficam fora deste lote.</p>
      <p>O trabalho aceito continua após fechar o navegador. Não envia guias ao cliente, não contabiliza nem retifica automaticamente. Resultados incertos exigem conferência e não serão repetidos.</p>
      {!preview.items.length && <p>Nenhuma empresa elegível para esta liberação.</p>}
      <ul>{preview.items.map(i => <li key={i.companyId}>{i.name} · Elegível</li>)}{preview.blocked.map(i => <li key={i.companyId}>{i.name} · {i.reason}</li>)}</ul>
      <div className="operacoes-programacao"><label>Digite a competência {competencia}<input value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} placeholder="AAAA-MM" /></label></div>
    </BatchDialog>}
    {task && <BatchDialog embedded={embedded} titulo="Acompanhamento da tarefa" aoFechar={closeTask} rodape={<Button variant="secondary" onClick={closeTask}>{embedded ? 'Voltar' : 'Fechar'}</Button>}>
      {taskError && <p role="alert">{taskError} Os últimos dados da tarefa foram preservados.</p>}
      <p>{task.descricao || 'Transmissão de apurações'} · {taskStatuses[task.status] || 'A verificar'}</p><p>{task.processadas ?? 0}/{task.total ?? '—'} itens processados</p>
      {task.erroMensagem && <p role="alert">{task.erroMensagem}</p>}<Button variant="secondary" onClick={() => openTask(task.jobId)}>Atualizar tarefa</Button>
    </BatchDialog>}
  </section>;
}
