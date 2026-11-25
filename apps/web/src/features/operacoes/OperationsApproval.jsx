import { OperationsFiscalWorkspace } from './OperationsFiscalWorkspace';
import { OperationsTablePagination } from './OperationsContextualTable';
import { orderOperationsRows } from './useOperationsTableContext';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { operationsReadQueue } from './operationsReadQueue';
import { useOperationsEvidence } from './useOperationsEvidence';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { CalculationEvidence } from './OperationsCalculationDetails';
import { readCalculationDetails, approvalEvidenceError, operationDate, operationInstant, calculationColumns, operationMoney as money } from './operationsDetails';

import { OperationsBatch } from './OperationsBatch';
import { OperationsCalculationBatch } from './OperationsCalculationBatch';
import { OperationsExternalBatch } from './OperationsExternalBatch';

const labels = { PENDING: 'A conferir', IN_REVIEW: 'Em revisão', CONFIRMED: 'Confirmada', INVALIDATED: 'Dados alterados · revisar', RELEASED: 'Liberada · aguardando execução', EXECUTED: 'Execução concluída', ATTENTION: 'Conferir resultado em Tarefas' };

function ApprovalDialog({ embedded, titulo, children, rodape, focusRef, footerTarget, ...props }) {
  return embedded ? <section className="operacoes-conferencia-detalhe" aria-label={titulo}><h3 ref={focusRef} tabIndex={-1}>{titulo}</h3>{children}{footerTarget ? createPortal(<div className="operacoes-acoes operacoes-destinos">{rodape}</div>,footerTarget) : <div className="operacoes-acoes operacoes-destinos">{rodape}</div>}</section> : <Modal titulo={titulo} {...props} rodape={rodape}><section aria-label={titulo}><h3 ref={focusRef} tabIndex={-1}>{titulo}</h3>{children}</section></Modal>;
}

// Presentation-only extension. Authoritative command checks keep using
// approvalEvidenceError without this historical exception.
function historicalEvidenceError(operation) {
  const error = approvalEvidenceError(operation, {historical:true});
  const h = operation?.calculation, fiscal = operation?.aptidaoFiscal?.fiscal;
  const snapshot = operation?.details?.snapshot?.value;
  if (error === 'Revisão do cálculo não corresponde à operação carregada'
    && h?.somenteLeitura === true && h.autorizaEfeitoFiscal === false
    && fiscal?.estado === 'CONFIRMADA' && h.comandoId === fiscal.comandoId
    && h.portalClientId === operation.companyId && h.competencia === operation.competencia
    && snapshot?.estado === 'transmitida' && snapshot.idempotencyKey === h.calculoId
    && snapshot.simulacaoSerpro?._portalTransmissao?.comandoId === h.comandoId
    && typeof h.dasValor === 'number' && Number.isFinite(h.dasValor)) return null;
  return error;
}
export function OperationsApproval({ api, rows, competencia, onChanged, onBusyChange, embedded = false, stage = null, evidence: suppliedEvidence = null, footerTarget, contextual = false, tableContext, modalStage = false, unavailable = false }) {
  const [data, setData] = useState({}), [error, setError] = useState(''), [mutationBusy, setBusy] = useState(false);
  const [routineBusy, setRoutineBusy] = useState(false), [routineDetail, setRoutineDetail] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [command, setCommand] = useState(null), [commandBusy, setCommandBusy] = useState(false);
  const busy = mutationBusy || routineBusy || detailBusy || commandBusy;
  const [selected, setSelected] = useState(null), [schedule, setSchedule] = useState(''), [batch, setBatch] = useState(null);
  const [message, setMessage] = useState('');
  const [checked, setChecked] = useState({});
  const [localStageFilter,setLocalStageFilter] = useState('all');
  const stageFilter = tableContext?.filter || localStageFilter;
  const setStageFilter = tableContext?.setFilter || setLocalStageFilter;
  const [localQuery, setLocalQuery] = useState(''), [confirmPreview, setConfirmPreview] = useState(null);
  const query = tableContext?.query ?? localQuery;
  const setQuery = tableContext?.setQuery || setLocalQuery;
  const [confirmation, setConfirmation] = useState({});
  const context = useRef({ api, competencia });
  if (context.current.api !== api || context.current.competencia !== competencia) context.current = { api, competencia };
  useEffect(() => {
    context.current = { api, competencia };
    return () => { context.current = { api: null, competencia: null }; };
  }, [api, competencia]);
  const lock = useRef(false);
  const detailRef = useRef(null), triggerRefs = useRef(new Map()), batchRef = useRef(null), refreshRef = useRef(null);
  const previewHeading=useRef(null);
  const stageTableRef=useRef(null);
  useEffect(()=>{if(confirmPreview)previewHeading.current?.focus();},[confirmPreview]);
  const returnTo = useRef(null), wasDetail = useRef(false);
  const detailOpen = Boolean(command || batch || (selected && data[selected] && rows.some(r => r.company.companyId === selected)));
  useEffect(() => {
    if (!embedded) return;
    if (detailOpen) { if (!command) detailRef.current?.focus(); }
    else if (wasDetail.current) {
      const target = returnTo.current === 'batch' ? batchRef.current : triggerRefs.current.get(returnTo.current);
      (target && !target.disabled ? target : stageTableRef.current || refreshRef.current)?.focus();
    }
    wasDetail.current = detailOpen;
  }, [embedded, selected, batch, detailOpen, command]);
  const writable = useRef(new Set());
  writable.current = new Set((unavailable ? [] : rows).filter(r => ['ACCOUNTANT', 'FIRM_ADMIN'].includes(String(r.company.myRole || '').toUpperCase())).map(r => r.company.companyId));
  const [readingState, setReading] = useState(true);
  const [confirmCompetencia, setConfirmCompetencia] = useState('');
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const ids = rows.map(r => r.company.companyId).sort().join('|');
  const grouped = true;
  const localEvidence = useOperationsEvidence(api, competencia, ids, grouped && !suppliedEvidence);
  const evidence = suppliedEvidence || localEvidence;
  const reading = readingState || evidence.loading;
  const commandsBlocked = unavailable || reading || Boolean(evidence.error) || Boolean(error);
  const readGeneration = useRef(0);
  function refreshEvidence() {
    evidence.reload();
  }
  useEffect(() => { setCommand(null); setCommandBusy(false); setMessage(''); }, [api, competencia]);
  useEffect(() => {
    if (command?.items.some(item => !rows.some(row => row.company.companyId === item.companyId))) { setCommand(null); setCommandBusy(false); setMessage(''); }
  }, [ids, command]);
  // Selection of a summary only prepares inspection. Commands still require
  // current operation, snapshot and audit, and the server revalidates revision.
  const selectable = value => grouped && !value.details ? Boolean(value.calculation) : !approvalEvidenceError(value);
  async function hydrate(items, open) {
    if (lock.current || busy || commandsBlocked) return;
    const origin = context.current, generation = readGeneration.current;
    const active = () => context.current === origin && readGeneration.current === generation;
    lock.current = true; setDetailBusy(true); setError('');
    const loaded = [];
    try {
      const results = await operationsReadQueue(items, async item => {
        if (!active()) return;
        const value = await api.getCompanyOperation(item.companyId, competencia);
        if (!active()) return;
        if (!value || value.ok === false || value.companyId !== item.companyId || value.competencia !== competencia || !value.revision || !Array.isArray(value.pending)) throw Error('Conferência indisponível.');
        const details = await readCalculationDetails(api, item.companyId, competencia);
        if (!active()) return;
        loaded.push({ ...data[item.companyId], ...value, details });
        if (api.getOperationsTransmissionDocuments && open === 'detail') {
          const proof = await api.getOperationsTransmissionDocuments(item.companyId, competencia).catch(() => null);
          if (!active()) return;
          setConfirmation(old => ({ ...old, [item.companyId]: proof?.companyId === item.companyId && proof.competencia === competencia && proof.confirmation?.fingerprint === value.fingerprint ? proof.confirmation : null }));
        }
      }, { isActive: active });
      if (!active()) return;
      setData(old => ({ ...old, ...Object.fromEntries(loaded.map(value => [value.companyId, value])) }));
      const failure = results.find(result => result?.status === 'rejected');
      if (failure || loaded.length !== items.length) throw failure?.reason || Error('Leitura incompleta. Atualize antes de continuar.');
      if (open === 'detail') {
        setSelected(loaded[0].companyId); setSchedule(loaded[0].schedule || '');
      } else {
        if (loaded.some(value => value.revision !== items.find(item => item.companyId === value.companyId)?.revision || !writable.current.has(value.companyId) || approvalEvidenceError(value) || value.blocked || (value.execution && value.execution.status !== 'DONE') || (stage !== 'calculado' && value.status !== 'CONFIRMED'))) {
          setChecked({});
          throw Error('Revisão, acesso ou evidências mudaram. Confira os detalhes antes de preparar novamente.');
        }
        if (stage === 'calculado') setConfirmPreview(loaded);
        else setBatch(loaded);
      }
    } catch (e) { if (active()) setError(e.message || 'Evidências indisponíveis. Atualize antes de continuar.'); }
    finally { lock.current = false; setDetailBusy(false); }
  }
  function openDetail(id) {
    returnTo.current = id;
    if (grouped) void hydrate([data[id]], 'detail');
    else { setSelected(id); setSchedule(data[id].schedule || ''); }
  }
  function prepareSelection(items) {
    returnTo.current = 'batch';
    if (grouped) void hydrate(items, 'preview');
    else if (stage === 'calculado') setConfirmPreview(items.map(d => ({ ...d })));
    else setBatch(items.map(d => ({ ...d })));
  }
  useEffect(() => {
    if (!grouped) return;
    readGeneration.current += 1;
    setConfirmation({}); setConfirmPreview(null); setChecked({}); setBatch(null); setSelected(null); setConfirmCompetencia('');
    setReading(evidence.loading); setError(evidence.error || '');
    if (evidence.loading || evidence.error) { setData({}); return; }
    const allowed = new Set(ids.split('|').filter(Boolean));
    const scoped = evidence.items.filter(item => allowed.has(item.companyId));
    if (scoped.length !== allowed.size || scoped.some(item => !Array.isArray(item.pending) || item.competencia !== competencia || !item.revision)) {
      setData({}); setError('Lista incompleta. Atualize as conferências antes de continuar.'); return;
    }
    setData(Object.fromEntries(scoped.map(item => [item.companyId, item])));
    return () => { readGeneration.current += 1; };
  }, [grouped, evidence.items, evidence.loading, evidence.error, ids, competencia]);
  if (!api?.getCompanyOperation || (!suppliedEvidence && !api?.getOperationEvidence)) return <p role="alert">Conferência agrupada indisponível neste ambiente. Abra a apuração da empresa para conferir os dados.</p>;
  const sorted = [...rows].sort((a, b) => (data[a.company.companyId]?.schedule || '9999').localeCompare(data[b.company.companyId]?.schedule || '9999'));
  const row = rows.find(r => r.company.companyId === selected);
  const current = data[selected];
  const canEditCurrent = writable.current.has(selected);
  const evidenceError = current ? historicalEvidenceError(current) : null;
  const canReleaseBatch = batch?.every(item => writable.current.has(item.companyId) && item.competencia === competencia && data[item.companyId]?.revision === item.revision && !data[item.companyId]?.blocked && !approvalEvidenceError(data[item.companyId]));
  const confirmed = Object.values(data).filter(v => v.status === 'CONFIRMED' && selectable(v) && !v.blocked && (!v.execution || v.execution.status === 'DONE') && writable.current.has(v.companyId));
  const chosen = confirmed.filter(v => checked[v.companyId] === v.revision);
  async function change(items, action) {
    if (lock.current) return;
    if (commandsBlocked || !items.length || items.some(item => !writable.current.has(item.companyId) || item.competencia !== competencia || data[item.companyId]?.revision !== item.revision)) {
      setError('Acesso, competência ou revisão mudou. Atualize as conferências antes de continuar.'); return;
    }
    if (stage && ['confirm', 'release'].includes(action) && items.some(item => data[item.companyId]?.regime !== 'SIMPLES')) { setError('Confirmação e transmissão disponíveis somente para o Simples comprovado na competência.'); return; }
    if (['confirm', 'release'].includes(action)) {
      const blocked = items.map(item => data[item.companyId]).find(value => approvalEvidenceError(value) || value.blocked || (value.execution && value.execution.status !== 'DONE'));
      if (blocked) { setError(blocked.blocked || approvalEvidenceError(blocked) || 'Há uma execução pendente ou de resultado incerto. Confira Tarefas antes de continuar.'); return; }
    }
    if (typeof api.saveCompanyOperation !== 'function' || (action === 'release' && typeof api.executeCompanyOperation !== 'function')) {
      setError('Ação indisponível neste ambiente. Abra a apuração da empresa para conferir os dados.'); return;
    }
    const origin = context.current;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    let count = 0;
    try {
      for (const item of items) {
        if (context.current !== origin) return;
        if (!writable.current.has(item.companyId)) throw Error('Seu acesso mudou. Esta empresa permite somente consulta.');
        let value = action === 'release' && item.status === 'RELEASED' ? item : await api.saveCompanyOperation(item.companyId, competencia, { action, expectedRevision: item.revision, requestId: crypto.randomUUID(), ...(action === 'schedule' ? { schedule: schedule || null } : {}) });
        if (context.current !== origin) return;
        if (!value || value.ok === false || value.companyId !== item.companyId || value.competencia !== competencia || !value.revision || !value.status) throw Error('Não foi possível confirmar a alteração persistida.');
        if (action === 'release' && api.executeCompanyOperation) {
          if (value.status !== 'RELEASED' || value.blocked) throw Error('Liberação não comprovada. Atualize a conferência antes de executar.');
          if (!writable.current.has(item.companyId)) throw Error('Seu acesso mudou. Confira a liberação salva antes de continuar.');
          const execution = await api.executeCompanyOperation(item.companyId, competencia, value.revision);
          if (context.current !== origin) return;
          if (execution?.ok !== true) throw Error('Resultado da execução não confirmado. Confira Tarefas antes de repetir.');
          value = await api.getCompanyOperation(item.companyId, competencia);
          if (context.current !== origin) return;
        }
        if (!value || value.ok === false || value.companyId !== item.companyId || value.competencia !== competencia || !value.revision || !value.status) throw Error('Não foi possível confirmar a alteração persistida.');
        const details = await readCalculationDetails(api, item.companyId, competencia);
        if (context.current !== origin) return;
        setData(old => ({ ...old, [item.companyId]: { ...value, details } })); count++;
      }
      setMessage(action === 'release' ? `${count} liberação(ões) processada(s). Confira o resultado e os documentos em Tarefas.` : 'Alteração salva.');
      onChanged?.();
    } catch (e) {
      if (context.current !== origin) return;
      setError(`${count ? `${count} alteração(ões) salva(s). ` : ''}${e.message || 'Resultado não confirmado.'} Atualize os dados antes de tentar novamente.`);
      // Não reenviar depois de timeout; a leitura recupera o resultado persistido.
      setData({});
    } finally { lock.current = false; setBusy(false); if (context.current === origin) { setBatch(null); setSelected(null); setChecked({}); setConfirmCompetencia(''); } }
  }
  const confirmable = Object.values(data).filter(v => !['CONFIRMED','RELEASED','EXECUTED'].includes(v.status) && selectable(v) && !v.blocked && !v.execution && writable.current.has(v.companyId));
  const stageEligible = Object.values(data).filter(value => writable.current.has(value.companyId));
  // Same scoped projection as the Calculado card. A local snapshot is required
  // for commands, but is not the only persisted evidence of an apuração.
  const calculationState = row => row.fluxo?.competencia === competencia ? row.fluxo.apuracao?.apurada ?? null : null;
  const stageRows = sorted.filter(r => stage !== 'confirmado' || (data[r.company.companyId]?.regime === 'PRESUMIDO' ? data[r.company.companyId]?.externalSummary?.apurar?.concluida === true : ['CONFIRMED','RELEASED','EXECUTED','ATTENTION','INVALIDATED'].includes(data[r.company.companyId]?.status)))
    .filter(r => stageFilter === 'all' || (stageFilter === 'ready' ? data[r.company.companyId]?.regime==='SIMPLES' && confirmed.some(d=>d.companyId===r.company.companyId) : stageFilter === 'external' ? data[r.company.companyId]?.regime==='PRESUMIDO' : stageFilter === 'done' ? calculationState(r) === true : stageFilter === 'pending' ? calculationState(r) === false : stageFilter === 'error' ? !!data[r.company.companyId]?.blocked || !!data[r.company.companyId]?.execution && data[r.company.companyId].execution.status !== 'DONE' : calculationState(r) == null))
    .filter(r => `${r.company.razao || r.company.razaoSocial || ''} ${r.company.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const orderedStageRows = orderOperationsRows(stageRows, tableContext?.order || 'stage');
  const page = Math.min(tableContext?.page || 0, Math.max(0, Math.ceil(stageRows.length / 30) - 1));
  const visibleStageRows = contextual ? orderedStageRows.slice(page * 30, page * 30 + 30) : orderedStageRows;
  const visibleEligible = stageEligible.filter(d => stageRows.some(r => r.company.companyId === d.companyId));
  const stageChosen = stageEligible.filter(d => checked[d.companyId] === d.revision);
  const allStageChosen = stageChosen;
  const commandEligible = stage === 'calculado' ? confirmable : confirmed;
  const canConfirmChosen = stageChosen.length > 0 && stageChosen.every(item => commandEligible.some(value => value.companyId === item.companyId && value.revision === item.revision) && item.regime === 'SIMPLES');
  const externalChosen = stageChosen.filter(item => item.regime === 'PRESUMIDO');
  function prepareCommand(kind) {
    if (busy || commandsBlocked || !stageChosen.length) return;
    returnTo.current = 'batch';
    setCommand({ kind, items: stageChosen.map(item => ({ companyId: item.companyId, revision: item.revision, name: rows.find(row => row.company.companyId === item.companyId)?.company.razao || rows.find(row => row.company.companyId === item.companyId)?.company.razaoSocial || item.companyId })) });
    setConfirmPreview(null);
  }
  function closeCommand() {
    setCommand(null); setChecked({}); refreshEvidence();
    requestAnimationFrame(() => stageTableRef.current?.focus());
  }
  const outsideSearch = stageChosen.filter(d => !stageRows.some(r => r.company.companyId === d.companyId)).length;
  const stageFooter = <div className="operacoes-stage-footer">
    {modalStage && <OperationsTablePagination page={page} total={stageRows.length} onPage={tableContext.setPage} disabled={busy || commandsBlocked}/>}
    <span>{stageChosen.length} selecionadas{outsideSearch > 0 && ` · ${outsideSearch} fora da busca`}</span>
    {!modalStage && <Button ref={refreshRef} variant="secondary" disabled={busy || reading || unavailable} onClick={refreshEvidence}>Atualizar conferências</Button>}
    {stage === 'calculado' && <Button disabled={busy || commandsBlocked || !stageChosen.length || !api.previewOperationsCalculation || !api.executeOperationsCalculation} onClick={() => prepareCommand('calculate')}>Calcular selecionadas</Button>}
    {externalChosen.length > 0 && <Button variant="secondary" disabled={busy || commandsBlocked || externalChosen.length !== stageChosen.length || !api.getOperationsExternal || !api.saveOperationsExternal} onClick={() => prepareCommand('external')}>Registrar conclusão externa</Button>}
    <Button ref={batchRef} variant={stage === 'calculado' ? 'secondary' : 'primary'} disabled={busy || commandsBlocked || !canConfirmChosen || !!error || (stage === 'confirmado' && !api?.executeCompanyOperation)} onClick={() => prepareSelection(stageChosen)}>{stage === 'calculado' ? 'Conferir selecionadas' : 'Transmitir selecionadas'}</Button>
  </div>;
  return <section aria-label="Conferência e programação de Operações">
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {stage === 'calculado' && (!api.previewOperationsCalculation || !api.executeOperationsCalculation) && <p role="alert">Cálculo em Operações indisponível neste ambiente. Abra a apuração da empresa para conferir os dados.</p>}
    {stage === 'confirmado' && !reading && !evidence.error && !error && (!api.saveCompanyOperation || !api.executeCompanyOperation) && <p role="alert">Transmissão selecionada indisponível neste ambiente. Abra a apuração da empresa para conferir os dados.</p>}
    {contextual && !modalStage && mutationBusy && !command && !(row && current) && !batch && <Modal titulo="Operação em andamento" ocupado><p role="status">Aguarde a conclusão da operação antes de navegar. Não repita a ação.</p></Modal>}
    {command?.kind === 'workspace' && <ApprovalDialog embedded={modalStage || !contextual} titulo="Apuração na central" tamanho="lg" ocupado={busy} aoFechar={() => !busy && closeCommand()}><OperationsFiscalWorkspace api={api} item={command.items[0]} competencia={competencia} onClose={closeCommand} onChanged={onChanged} onBusyChange={setCommandBusy} canWrite={id => !commandsBlocked && writable.current.has(id)} /></ApprovalDialog>}
    {command?.kind === 'calculate' && <ApprovalDialog embedded={modalStage || !contextual} titulo="Calcular selecionadas" tamanho="lg" ocupado={busy} aoFechar={() => !busy && closeCommand()}><OperationsCalculationBatch onPrepareIndividual={item => setCommand({ kind: "workspace", items: [item] })} disabled={commandsBlocked} api={api} items={command.items} competencia={competencia} footerTarget={contextual && !modalStage ? undefined : footerTarget} onClose={closeCommand} onChanged={onChanged} onBusyChange={setCommandBusy} canWrite={id => !commandsBlocked && writable.current.has(id)} /></ApprovalDialog>}
    {command?.kind === 'external' && <ApprovalDialog embedded={modalStage || !contextual} titulo="Conclusão externa" tamanho="lg" ocupado={busy} aoFechar={() => !busy && closeCommand()}><OperationsExternalBatch api={api} items={command.items} competencia={competencia} taskKey={stage === 'calculado' ? 'apurar' : 'transmitir'} footerTarget={contextual && !modalStage ? undefined : footerTarget} onClose={closeCommand} onChanged={onChanged} onBusyChange={setCommandBusy} canWrite={id => !commandsBlocked && writable.current.has(id)} /></ApprovalDialog>}
    {!command && stage !== 'calculado' && api?.previewOperationsBatch && <div hidden={embedded && detailOpen}><OperationsBatch actionsVisible={!detailOpen} footerTarget={contextual && !modalStage ? undefined : footerTarget} key={competencia} api={api} competencia={competencia} disabled={commandsBlocked || mutationBusy || detailBusy || Boolean(selected || batch)} onChanged={onChanged} embedded={embedded && (modalStage || !contextual)} restoreTriggerFocus={contextual} onBusyChange={setRoutineBusy} onDetailChange={setRoutineDetail} /></div>}
    {!stage && !(embedded && ((row && current) || batch || routineDetail)) && <><div className="operacoes-cabecalho"><h3>Apurações da competência</h3><div className="operacoes-acoes"><Button ref={refreshRef} variant="secondary" disabled={busy || reading || unavailable} onClick={refreshEvidence}>Atualizar conferências</Button>{writable.current.size > 0 && <><Button variant="secondary" disabled={busy || commandsBlocked || !confirmed.length || !!error} onClick={() => setChecked(Object.fromEntries(confirmed.map(v => [v.companyId, v.revision])))}>Selecionar elegíveis ({confirmed.length})</Button><Button ref={batchRef} variant="secondary" disabled={busy || commandsBlocked || !chosen.length || !!error} onClick={() => prepareSelection(chosen)}>Transmitir selecionadas ({chosen.length})</Button></>}</div></div>

    <div className="operacoes-tabela-scroll" role="region" aria-label="Conferência das empresas" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th className="operacoes-coluna-selecao">Selecionar</th><th>Empresa</th><th>Cálculo salvo</th><th>Faturamento salvo</th><th>Anexo do formulário</th><th>Conferência e pendências</th><th>Ação</th></tr></thead><tbody>{sorted.map(({ company }) => { const d = data[company.companyId], name = company.razao || company.razaoSocial || company.cnpj; return <tr key={company.companyId}><td className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name}`} disabled={busy || commandsBlocked || !confirmed.some(v => v.companyId === company.companyId)} checked={Boolean(d && checked[company.companyId] === d.revision)} onChange={e => setChecked(old => ({ ...old, [company.companyId]: e.target.checked ? d.revision : null }))} /></label></td><th scope="row">{name}</th><td>{money(d?.calculation?.dasValor)}</td><td>Interno: {money(d?.details?.snapshot?.value?.receitaInterna)}<br />Externo: {money(d?.details?.snapshot?.value?.receitaExterna)}</td><td>{d?.details?.snapshot?.value?.atividadesEscolhidas?.map(a => a.anexoImplicito ?? 'Não registrado').join(' · ') || 'Não disponível no snapshot'}</td><td>{d ? `${d.schedule ? operationDate(d.schedule) + ' · ' + d.schedule.slice(11,16) : 'Sem programação'} · ${labels[d.status] || 'A verificar'}${d.pending.length ? ` · ${d.pending.length} pendência(s) do período` : ''}` : reading ? 'Conferindo…' : 'Conferência indisponível'}{d?.blocked && <p>{d.blocked}</p>}{d && historicalEvidenceError(d) && <p role="alert">{historicalEvidenceError(d)}. Atualize a conferência ou abra a empresa para verificar.</p>}<p>Auditoria: {d?.details?.auditoria?.value ? `${d.details.auditoria.value.totalAchados ?? 'A verificar'} achados` : 'Indisponível; não equivale a aprovação'}</p></td><td><Button ref={el => { if (el) triggerRefs.current.set(company.companyId, el); else triggerRefs.current.delete(company.companyId); }} size="sm" variant="secondary" disabled={!d || busy || commandsBlocked} onClick={() => openDetail(company.companyId)}>Conferir</Button></td></tr>; })}</tbody></table></div></>}
    {stage && !command && !row && !batch && !routineDetail && <>
      {!modalStage && <p>Competência {competencia} · {stage === 'calculado' ? 'Conferir registra a revisão, sem transmitir.' : 'Fila não comprova transmissão. Liberar rotina inclui todas as confirmadas elegíveis, independentemente da seleção manual.'}</p>}
      <div className="operacoes-stage-filters"><label className="operacoes-rotinas-filtros">Buscar empresa<input type="search" disabled={busy} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <label className="operacoes-rotinas-filtros">Situação da etapa<select aria-label="Situação da etapa" disabled={busy} value={stageFilter} onChange={e=>setStageFilter(e.target.value)}><option value="all">Todas as empresas deste conjunto</option>{stage==='confirmado'?<><option value="ready">Prontas para transmitir</option><option value="error">Com erro ou revisão</option><option value="external">Apuração externa</option></>:<><option value="done">Calculadas</option><option value="pending">Não calculadas</option><option value="error">Atenção ou bloqueio</option><option value="unknown">A verificar</option></>}</select></label>
      {modalStage && <Button ref={refreshRef} variant="secondary" disabled={busy || reading || unavailable} onClick={refreshEvidence}>Atualizar conferências</Button>}</div>
      {reading && <p role="status">Lendo cálculos e evidências…</p>}{detailBusy && <p role="status">Conferindo evidências selecionadas…</p>}
      {(!modalStage || allStageChosen.length > 0) && <div className="operacoes-acoes operacoes-stage-selection">{!modalStage && <Button variant="secondary" disabled={busy || commandsBlocked || !visibleEligible.length} onClick={() => { setConfirmPreview(null); setChecked(old => ({ ...old, ...Object.fromEntries(visibleEligible.map(value => [value.companyId, value.revision])) })); }}>Selecionar todas do filtro ({visibleEligible.length})</Button>}<Button variant="secondary" disabled={busy || !allStageChosen.length} onClick={() => { setConfirmPreview(null); setChecked({}); }}>Limpar seleção</Button></div>}
      <div ref={stageTableRef} className="operacoes-tabela-scroll" role="region" aria-label={stage === 'calculado' ? 'Cálculos para conferência' : 'Apurações confirmadas'} tabIndex={0}><table className="operacoes-tabela operacoes-approval-cards"><thead><tr><th className="operacoes-coluna-selecao"><input type="checkbox" aria-label={`Selecionar todas as elegíveis do filtro (${visibleEligible.length})`} disabled={busy||commandsBlocked||!visibleEligible.length} checked={visibleEligible.length>0&&visibleEligible.every(d=>checked[d.companyId]===d.revision)} onChange={e=>{setConfirmPreview(null);setChecked(old=>({...old,...Object.fromEntries(visibleEligible.map(d=>[d.companyId,e.target.checked?d.revision:null]))}));}}/></th><th>Empresa</th><th>{stage==='calculado'?'Receita calculada':'Receita confirmada'}</th><th>Impostos</th>{stage==='calculado'?<><th>Avisos</th><th>Erros</th></>:<th>Confirmação</th>}<th>Situação / ações</th></tr></thead><tbody>{visibleStageRows.map(stageRow=>{const {company}=stageRow;
        const d=data[company.companyId], c=calculationColumns(d), name=company.razao||company.razaoSocial||company.cnpj;
        const historicalError = d?.details ? approvalEvidenceError(d, {historical:true}) : null;
        if (historicalError && !historicalEvidenceError(d)) c.errors = c.errors.filter(message => message !== historicalError);
        if (d?.blockingForNewActionOnly) {
          c.errors = c.errors.filter(message => message !== d.blocked);
          c.warnings.push('Transmissão confirmada. Nova transmissão indisponível.', ...(d.aptidaoFiscal?.pendencias || []).filter(p => typeof p === 'string'));
        }
        const summaryProof = d?.confirmationSummary?.status === 'AVAILABLE' ? d.confirmationSummary.confirmation : null;
        const matchingSummary = typeof d?.fingerprint === 'string' && d.fingerprint.length > 0 && summaryProof?.fingerprint === d.fingerprint ? summaryProof : null;
        // A fresh detail result, including null, supersedes a presentation summary.
        const proof = Object.hasOwn(confirmation, company.companyId) ? confirmation[company.companyId] : matchingSummary;
        const calculated = Boolean(d?.calculation);
        const missingCalculation = calculationState(stageRow) === false ? 'Não calculado' : 'Cálculo local não disponível';
        const auditComplete = ['COMPLETE', 'REVIEW'].includes(d?.auditSummary?.status) || Boolean(d?.details?.auditoria?.value);
        const warningLabel = !d ? 'Não disponível' : !calculated ? missingCalculation : c.warnings.length ? c.warnings.join(' · ') : auditComplete ? 'Sem avisos' : 'Auditoria a conferir';
        const errorLabel = c.errors.join(' · ') || (!d ? 'Não disponível' : !calculated ? missingCalculation : 'Sem erros');
        return <tr key={company.companyId}>
          <td className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name}`} checked={!!d&&checked[company.companyId]===d.revision} disabled={busy||commandsBlocked||!stageEligible.some(v=>v.companyId===company.companyId)} onChange={e=>{setConfirmPreview(null);setChecked(old=>({...old,[company.companyId]:e.target.checked?d.revision:null}));}}/></label></td>
          <th scope="row"><strong>{name}</strong><small>{d?.regime === 'SIMPLES' ? 'Simples Nacional' : d?.regime === 'PRESUMIDO' ? 'Lucro Presumido' : 'Regime a conferir'}{!modalStage && ` · ${d?.routine?.label || 'Rotina não comprovada'}`}</small><small>{company.cnpj || 'CNPJ não informado'}</small>{modalStage && stage === 'confirmado' && <small>{d?.routine?.label || 'Rotina não comprovada'}</small>}</th>
          <td data-label="Receita">{d && !calculated && c.receita == null ? missingCalculation : money(c.receita)}</td>
          <td data-label="Impostos">{c.impostos.length ? c.impostos.map(t=><div key={t.nome}>{t.nome}<span className="operacoes-valor">{money(t.valor)}</span></div>) : d && !calculated ? missingCalculation : 'Impostos indisponíveis'}</td>
          {stage === 'calculado' ? <><td data-label="Avisos">{warningLabel}</td><td data-label="Erros">{errorLabel}</td></> : <td data-label="Confirmação">{d?.regime === 'PRESUMIDO' ? d.externalSummary?.transmitir?.concluida ? 'Entrega externa registrada' : 'Apuração externa concluída' : d ? labels[d.status] || 'A verificar' : reading ? 'Lendo…' : 'Leitura indisponível'}<small>{proof?.by || (d?.confirmationSummary?.status === 'INCOMPLETE' ? 'Histórico incompleto · conferir detalhe' : 'Autor não disponível')}</small><small>{operationInstant(proof?.at)}</small>{c.errors.length > 0 && <p role="alert">{c.errors.join(' · ')}</p>}</td>}
          <td data-label="Ações"><div className="operacoes-acoes">
            {competencia >= '2026-11' && d?.regime === 'SIMPLES' && <Button size="sm" variant="secondary" disabled={busy || commandsBlocked} onClick={() => { returnTo.current=company.companyId; setSelected(null); setCommand({kind:'workspace',items:[{companyId:company.companyId,name}]}); }}>Apurar na central</Button>}{modalStage && stage === 'calculado' && <><Button size="sm" variant="secondary" disabled={!d || busy || commandsBlocked || !writable.current.has(company.companyId) || !api.previewOperationsCalculation || !api.executeOperationsCalculation} onClick={() => { returnTo.current=company.companyId; setCommand({kind:'calculate',items:[{companyId:company.companyId,revision:d.revision,name}]}); }}>Calcular</Button><InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(company.companyId, 'cadastroFiscal')}?competencia=${encodeURIComponent(competencia)}`}>Conferir</InternalLink></>}
            {(!modalStage || stage !== 'calculado') && <><Button ref={el=>{if(el)triggerRefs.current.set(company.companyId,el);else triggerRefs.current.delete(company.companyId);}} size="sm" variant="secondary" disabled={!d||busy||commandsBlocked} onClick={()=>{if(d.regime === 'PRESUMIDO'){returnTo.current=company.companyId;setCommand({kind:'external',items:[{companyId:company.companyId,name}]});}else openDetail(company.companyId);}}>Conferir detalhes</Button>{modalStage && <InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(company.companyId, 'cadastroFiscal')}?competencia=${encodeURIComponent(competencia)}`}>Abrir apuração</InternalLink>}</>}
          </div></td>
        </tr>;
      })}</tbody></table></div>{!stageRows.length&&!reading&&!error&&<p>Nenhuma empresa nesta etapa ou busca.</p>}
      {contextual && !modalStage && <OperationsTablePagination page={page} total={stageRows.length} onPage={tableContext.setPage} disabled={busy || commandsBlocked} />}
      {confirmPreview && <div className="operacoes-previa"><h3 ref={previewHeading} tabIndex={-1}>Conferir cálculos selecionados</h3><p>Registrar conferência destas empresas na competência {competencia}, sem transmitir.</p><ul>{confirmPreview.map(d=><li key={d.companyId}>{rows.find(r=>r.company.companyId===d.companyId)?.company.razao||d.companyId}</li>)}</ul><Button disabled={busy||confirmPreview.some(d=>!confirmable.some(c=>c.companyId===d.companyId&&c.revision===d.revision))} onClick={()=>{const items=confirmPreview;setConfirmPreview(null);change(items,'confirm');}}>Confirmar cálculos selecionados</Button> <Button variant="secondary" disabled={busy} onClick={()=>{setConfirmPreview(null);batchRef.current?.focus();}}>Cancelar</Button></div>}
      {footerTarget ? createPortal(stageFooter, footerTarget) : stageFooter}
    </>}
    {row && current && <ApprovalDialog footerTarget={footerTarget} focusRef={detailRef} embedded={embedded && (modalStage || !contextual)} className="operacoes-dialogo" titulo={`Conferir ${row.company.razao || row.company.razaoSocial || row.company.cnpj}`} ocupado={busy} aoFechar={() => !busy && setSelected(null)} rodape={<Button disabled={busy} variant="secondary" onClick={() => setSelected(null)}>{embedded ? 'Voltar' : 'Fechar'}</Button>}>
      <p>Competência {competencia} · {labels[current.status]}</p>
      {stage === 'confirmado' && <p>Confirmação: {confirmation[selected]?.by || 'Autor não disponível'} · {operationInstant(confirmation[selected]?.at)}</p>}
      <p>Imposto salvo: {money(current.calculation?.dasValor)}</p><CalculationEvidence details={current.details} />
      {current.blocked && <p role={current.blockingForNewActionOnly ? "status" : "alert"}>{current.blocked}</p>}
      {evidenceError && <p role="alert">{evidenceError}. Confirmar e liberar estão indisponíveis até atualizar as evidências.</p>}
      <Button variant="secondary" disabled={busy || reading || unavailable} onClick={refreshEvidence}>Atualizar evidências</Button>
      {current.execution && <p role="status">{current.execution.message || 'Acompanhe os detalhes e documentos em Tarefas.'}</p>}
      {current.pending.map(p => <p key={p.id}>{p.observacoes || p.motivo}</p>)}
      {!busy && <div className="operacoes-acoes"><InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(selected, 'cadastroFiscal')}?competencia=${competencia}`}>Abrir central de apuração</InternalLink><InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(selected, 'auditoria')}?competencia=${competencia}`}>Revisar notas da competência</InternalLink></div>}
      {!canEditCurrent && <p role="status">Seu acesso permite somente consultar esta apuração.</p>}
      {canEditCurrent && <><p>Confirme somente após conferir o cálculo salvo, faturamento, anexos e divergências. Confirmar registra sua conferência; não transmite. A liberação exige outra prévia explícita.</p>
      <div className="operacoes-acoes"><Button disabled={busy || commandsBlocked || !!approvalEvidenceError(current) || !!current.blocked || (current.execution && current.execution.status !== 'DONE') || current.status === 'RELEASED'} onClick={() => change([current], 'confirm')}>Confirmar apuração</Button><Button variant="secondary" disabled={busy} onClick={() => change([current], 'review')}>Marcar para revisão</Button></div>
      {current.status === 'RELEASED' && !evidenceError && !current.blocked && !current.execution && <Button disabled={busy} onClick={() => { setBatch([current]); setSelected(null); }}>Executar liberação</Button>}
      <div className="operacoes-programacao"><label>Programar conferência <input type="datetime-local" value={schedule} disabled={busy} onChange={e => setSchedule(e.target.value)} /></label>
      <Button variant="secondary" disabled={busy} onClick={() => change([current], 'schedule')}>Salvar programação</Button></div></>}
    </ApprovalDialog>}
    {batch && <ApprovalDialog footerTarget={footerTarget} focusRef={detailRef} embedded={embedded && (modalStage || !contextual)} className="operacoes-dialogo" titulo="Conferir transmissão" ocupado={busy} aoFechar={() => { if (!busy) { setBatch(null); setConfirmCompetencia(''); } }} rodape={<><Button variant="secondary" disabled={busy} onClick={() => { setBatch(null); setConfirmCompetencia(''); }}>Cancelar</Button><Button disabled={busy || !canReleaseBatch || confirmCompetencia !== competencia} onClick={() => change(batch, 'release')}>Liberar e executar</Button></>}>
      {!canReleaseBatch && <p role="alert">Acesso, revisão ou evidências indisponíveis. Atualize as empresas antes de liberar.</p>}
      <p>Competência {competencia} · {batch.length} empresa(s) selecionada(s), sujeitas à revalidação.</p>
      <ul>{batch.map(item => <li key={item.companyId}>{rows.find(r => r.company.companyId === item.companyId)?.company.razao || item.companyId}</li>)}</ul>
      <ul aria-label="Consequências da transmissão">
        <li>Pode transmitir declarações e buscar documentos faltantes. DAS e extratos completos serão reutilizados.</li>
        <li>Dados alterados, notas pendentes ou procuração inválida bloqueiam a execução. Não faz retificação automática.</li>
        <li>Não envia guias ao cliente nem importa lançamentos no ERP. Tentativa anterior sem documento ou com resultado incerto exige conferir Tarefas e a apuração antes de repetir; esta ação não é uma recuperação documental independente.</li>
      </ul>
      <div className="operacoes-programacao"><label>Digite a competência {competencia} para executar<input value={confirmCompetencia} disabled={busy} onChange={e => setConfirmCompetencia(e.target.value)} placeholder="AAAA-MM" /></label></div>
    </ApprovalDialog>}
  </section>;
}
