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

const labels = { PENDING: 'A conferir', IN_REVIEW: 'Em revisão', CONFIRMED: 'Confirmada', INVALIDATED: 'Dados alterados · revisar', RELEASED: 'Liberada · aguardando execução', EXECUTED: 'Execução concluída', ATTENTION: 'Conferir resultado em Tarefas' };

function ApprovalDialog({ embedded, titulo, children, rodape, focusRef, ...props }) {
  return embedded ? <section className="operacoes-conferencia-detalhe" aria-label={titulo}><h3 ref={focusRef} tabIndex={-1}>{titulo}</h3>{children}<div className="operacoes-acoes operacoes-destinos">{rodape}</div></section> : <Modal titulo={titulo} {...props} rodape={rodape}>{children}</Modal>;
}

export function OperationsApproval({ api, rows, competencia, onChanged, onBusyChange, embedded = false, stage = null, evidence: suppliedEvidence = null }) {
  const [data, setData] = useState({}), [error, setError] = useState(''), [mutationBusy, setBusy] = useState(false);
  const [routineBusy, setRoutineBusy] = useState(false), [routineDetail, setRoutineDetail] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const busy = mutationBusy || routineBusy || detailBusy;
  const [selected, setSelected] = useState(null), [schedule, setSchedule] = useState(''), [batch, setBatch] = useState(null);
  const [message, setMessage] = useState('');
  const [checked, setChecked] = useState({});
  const [stageFilter,setStageFilter] = useState('all');
  const [query, setQuery] = useState(''), [confirmPreview, setConfirmPreview] = useState(null);
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
  useEffect(()=>{if(confirmPreview)previewHeading.current?.focus();},[confirmPreview]);
  const returnTo = useRef(null), wasDetail = useRef(false);
  const detailOpen = Boolean(batch || (selected && data[selected] && rows.some(r => r.company.companyId === selected)));
  useEffect(() => {
    if (!embedded) return;
    if (detailOpen) detailRef.current?.focus();
    else if (wasDetail.current) {
      const target = returnTo.current === 'batch' ? batchRef.current : triggerRefs.current.get(returnTo.current);
      (target && !target.disabled ? target : refreshRef.current)?.focus();
    }
    wasDetail.current = detailOpen;
  }, [embedded, selected, batch, detailOpen]);
  const writable = useRef(new Set());
  writable.current = new Set(rows.filter(r => ['ACCOUNTANT', 'FIRM_ADMIN'].includes(String(r.company.myRole || '').toUpperCase())).map(r => r.company.companyId));
  const [reading, setReading] = useState(true);
  const [confirmCompetencia, setConfirmCompetencia] = useState('');
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const ids = rows.map(r => r.company.companyId).sort().join('|');
  const grouped = true;
  const localEvidence = useOperationsEvidence(api, competencia, ids, grouped && !suppliedEvidence);
  const evidence = suppliedEvidence || localEvidence;
  const readGeneration = useRef(0);
  function refreshEvidence() {
    evidence.reload();
  }
  // Selection of a summary only prepares inspection. Commands still require
  // current operation, snapshot and audit, and the server revalidates revision.
  const selectable = value => grouped && !value.details ? Boolean(value.calculation) : !approvalEvidenceError(value);
  async function hydrate(items, open) {
    if (lock.current || busy || reading) return;
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
        loaded.push({ ...value, details });
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
  const evidenceError = current ? approvalEvidenceError(current, { historical: true }) : null;
  const canReleaseBatch = batch?.every(item => writable.current.has(item.companyId) && item.competencia === competencia && data[item.companyId]?.revision === item.revision && !data[item.companyId]?.blocked && !approvalEvidenceError(data[item.companyId]));
  const confirmed = Object.values(data).filter(v => v.status === 'CONFIRMED' && selectable(v) && !v.blocked && (!v.execution || v.execution.status === 'DONE') && writable.current.has(v.companyId));
  const chosen = confirmed.filter(v => checked[v.companyId] === v.revision);
  async function change(items, action) {
    if (lock.current || reading || items.some(item => !writable.current.has(item.companyId) || item.competencia !== competencia || data[item.companyId]?.revision !== item.revision)) return;
    if (['confirm', 'release'].includes(action) && items.some(item => approvalEvidenceError(data[item.companyId]) || data[item.companyId]?.blocked || (data[item.companyId]?.execution && data[item.companyId].execution.status !== 'DONE'))) return;
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
  const stageEligible = stage === 'calculado' ? confirmable : confirmed;
  const stageRows = sorted.filter(r => stage !== 'confirmado' || ['CONFIRMED','RELEASED','EXECUTED','ATTENTION','INVALIDATED'].includes(data[r.company.companyId]?.status))
    .filter(r => stageFilter === 'all' || (stageFilter === 'done' ? !!data[r.company.companyId]?.calculation : stageFilter === 'pending' ? !!data[r.company.companyId] && !data[r.company.companyId].calculation : stageFilter === 'error' ? !!data[r.company.companyId]?.blocked || !!data[r.company.companyId]?.execution && data[r.company.companyId].execution.status !== 'DONE' : !data[r.company.companyId]))
    .filter(r => `${r.company.razao || r.company.razaoSocial || ''} ${r.company.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const visibleEligible = stageEligible.filter(d => stageRows.some(r => r.company.companyId === d.companyId));
  const stageChosen = stageEligible.filter(d => checked[d.companyId] === d.revision);
  return <section aria-label="Conferência e programação de Operações">
    {stage !== 'calculado' && api?.previewOperationsBatch && <OperationsBatch key={competencia} api={api} competencia={competencia} disabled={mutationBusy || detailBusy || Boolean(selected || batch)} onChanged={onChanged} embedded={embedded} onBusyChange={setRoutineBusy} onDetailChange={setRoutineDetail} />}
    {!stage && !(embedded && ((row && current) || batch || routineDetail)) && <><div className="operacoes-cabecalho"><h3>Apurações da competência</h3><div className="operacoes-acoes"><Button ref={refreshRef} variant="secondary" disabled={busy || reading} onClick={refreshEvidence}>Atualizar conferências</Button>{writable.current.size > 0 && <><Button variant="secondary" disabled={busy || reading || !confirmed.length || !!error} onClick={() => setChecked(Object.fromEntries(confirmed.map(v => [v.companyId, v.revision])))}>Selecionar elegíveis ({confirmed.length})</Button><Button ref={batchRef} variant="secondary" disabled={busy || reading || !chosen.length || !!error} onClick={() => prepareSelection(chosen)}>Transmitir selecionadas ({chosen.length})</Button></>}</div></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="operacoes-tabela-scroll" role="region" aria-label="Conferência das empresas" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th className="operacoes-coluna-selecao">Selecionar</th><th>Empresa</th><th>Cálculo salvo</th><th>Faturamento salvo</th><th>Anexo do formulário</th><th>Conferência e pendências</th><th>Ação</th></tr></thead><tbody>{sorted.map(({ company }) => { const d = data[company.companyId], name = company.razao || company.razaoSocial || company.cnpj; return <tr key={company.companyId}><td className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name}`} disabled={busy || reading || !confirmed.some(v => v.companyId === company.companyId)} checked={Boolean(d && checked[company.companyId] === d.revision)} onChange={e => setChecked(old => ({ ...old, [company.companyId]: e.target.checked ? d.revision : null }))} /></label></td><th scope="row">{name}</th><td>{money(d?.calculation?.dasValor)}</td><td>Interno: {money(d?.details?.snapshot?.value?.receitaInterna)}<br />Externo: {money(d?.details?.snapshot?.value?.receitaExterna)}</td><td>{d?.details?.snapshot?.value?.atividadesEscolhidas?.map(a => a.anexoImplicito ?? 'Não registrado').join(' · ') || 'Não disponível no snapshot'}</td><td>{d ? `${d.schedule ? operationDate(d.schedule) + ' · ' + d.schedule.slice(11,16) : 'Sem programação'} · ${labels[d.status] || 'A verificar'}${d.pending.length ? ` · ${d.pending.length} pendência(s) do período` : ''}` : reading ? 'Conferindo…' : 'Conferência indisponível'}{d?.blocked && <p>{d.blocked}</p>}{d && approvalEvidenceError(d, { historical: true }) && <p role="alert">{approvalEvidenceError(d, { historical: true })}. Atualize a conferência ou abra a empresa para verificar.</p>}<p>Auditoria: {d?.details?.auditoria?.value ? `${d.details.auditoria.value.totalAchados ?? 'A verificar'} achados` : 'Indisponível; não equivale a aprovação'}</p></td><td><Button ref={el => { if (el) triggerRefs.current.set(company.companyId, el); else triggerRefs.current.delete(company.companyId); }} size="sm" variant="secondary" disabled={!d || busy || reading} onClick={() => openDetail(company.companyId)}>Conferir</Button></td></tr>; })}</tbody></table></div></>}
    {stage && !row && !batch && !routineDetail && <>
      <p>Competência {competencia} · {stage === 'calculado' ? 'Conferir registra a revisão, sem transmitir.' : 'Fila não comprova transmissão. Liberar rotina inclui todas as confirmadas elegíveis, independentemente da seleção manual.'}</p>
      <label className="operacoes-rotinas-filtros">Buscar empresa<input type="search" disabled={busy} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      {stage==='calculado'&&<label className="operacoes-rotinas-filtros">Situação da etapa<select aria-label="Situação da etapa" disabled={busy} value={stageFilter} onChange={e=>setStageFilter(e.target.value)}><option value="all">Todas as empresas deste conjunto</option><option value="done">Calculadas</option><option value="pending">Não calculadas</option><option value="error">Atenção ou bloqueio</option><option value="unknown">A verificar</option></select></label>}
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{reading && <p role="status">Lendo cálculos e evidências…</p>}{detailBusy && <p role="status">Conferindo evidências selecionadas…</p>}
      <div className="operacoes-tabela-scroll" role="region" aria-label={stage === 'calculado' ? 'Cálculos para conferência' : 'Apurações confirmadas'} tabIndex={0}><table className="operacoes-tabela"><thead><tr><th className="operacoes-coluna-selecao"><input type="checkbox" aria-label="Selecionar elegíveis exibidas" disabled={busy||reading||!visibleEligible.length} checked={visibleEligible.length>0&&visibleEligible.every(d=>checked[d.companyId]===d.revision)} onChange={e=>{setConfirmPreview(null);setChecked(old=>({...old,...Object.fromEntries(visibleEligible.map(d=>[d.companyId,e.target.checked?d.revision:null]))}));}}/></th><th>Empresa</th><th>{stage==='calculado'?'Receita calculada':'Receita confirmada'}</th><th>Impostos</th>{stage==='calculado'?<><th>Avisos</th><th>Erros</th></>:<th>Confirmação</th>}<th>Situação / ações</th></tr></thead><tbody>{stageRows.map(({company})=>{
        const d=data[company.companyId], c=calculationColumns(d), name=company.razao||company.razaoSocial||company.cnpj;
        const summaryProof = d?.confirmationSummary?.status === 'AVAILABLE' ? d.confirmationSummary.confirmation : null;
        const matchingSummary = typeof d?.fingerprint === 'string' && d.fingerprint.length > 0 && summaryProof?.fingerprint === d.fingerprint ? summaryProof : null;
        // A fresh detail result, including null, supersedes a presentation summary.
        const proof = Object.hasOwn(confirmation, company.companyId) ? confirmation[company.companyId] : matchingSummary;
        return <tr key={company.companyId}><td className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name}`} checked={!!d&&checked[company.companyId]===d.revision} disabled={busy||reading||!stageEligible.some(v=>v.companyId===company.companyId)} onChange={e=>{setConfirmPreview(null);setChecked(old=>({...old,[company.companyId]:e.target.checked?d.revision:null}));}}/></label></td><th scope="row">{name}</th><td>{money(c.receita)}</td><td>{c.impostos.length?c.impostos.map(t=><div key={t.nome}>{t.nome}<strong className="operacoes-valor">{money(t.valor)}</strong></div>):'Impostos indisponíveis'}</td>{stage==='calculado'?<><td>{c.warnings.join(' · ')||'Nenhum aviso identificado nesta leitura'}</td><td>{c.errors.join(' · ')||(grouped&&!d?.details?'Conferir evidências':'Nenhum erro impeditivo identificado')}</td></>:<td>{proof?.by || (d?.confirmationSummary?.status === 'INCOMPLETE' ? 'Histórico incompleto · conferir detalhe' : 'Autor não disponível')}<small>{operationInstant(proof?.at)}</small></td>}<td>{d?labels[d.status]||'A verificar':reading?'Lendo…':'Leitura indisponível'}{stage!=='calculado'&&c.errors.length>0&&<p>{c.errors.join(' · ')}</p>}<Button ref={el=>{if(el)triggerRefs.current.set(company.companyId,el);else triggerRefs.current.delete(company.companyId);}} size="sm" variant="secondary" disabled={!d||busy||reading} onClick={()=>openDetail(company.companyId)}>Conferir detalhes</Button></td></tr>;
      })}</tbody></table></div>{!stageRows.length&&!reading&&!error&&<p>Nenhuma empresa nesta etapa ou busca.</p>}
      {confirmPreview && <div className="operacoes-previa"><h3 ref={previewHeading} tabIndex={-1}>Conferir liberação para transmissão</h3><p>Registrar conferência destas empresas na competência {competencia}, sem transmitir.</p><ul>{confirmPreview.map(d=><li key={d.companyId}>{rows.find(r=>r.company.companyId===d.companyId)?.company.razao||d.companyId}</li>)}</ul><Button disabled={busy||confirmPreview.some(d=>!confirmable.some(c=>c.companyId===d.companyId&&c.revision===d.revision))} onClick={()=>{const items=confirmPreview;setConfirmPreview(null);change(items,'confirm');}}>Confirmar cálculos selecionados</Button> <Button variant="secondary" disabled={busy} onClick={()=>{setConfirmPreview(null);batchRef.current?.focus();}}>Cancelar</Button></div>}
      <div className="operacoes-stage-footer"><span>{stageChosen.length} selecionadas · {stageChosen.filter(d=>!stageRows.some(r=>r.company.companyId===d.companyId)).length} fora da busca</span><Button ref={refreshRef} variant="secondary" disabled={busy||reading} onClick={refreshEvidence}>Atualizar conferências</Button><Button ref={batchRef} disabled={busy||reading||!stageChosen.length||!!error||(stage==='confirmado'&&!api?.executeCompanyOperation)} onClick={()=>prepareSelection(stageChosen)}>{stage==='calculado'?'Liberar para transmissão':'Transmitir selecionadas'}</Button></div>
    </>}
    {row && current && <ApprovalDialog focusRef={detailRef} embedded={embedded} className="operacoes-dialogo" titulo={`Conferir ${row.company.razao || row.company.razaoSocial || row.company.cnpj}`} ocupado={busy} aoFechar={() => !busy && setSelected(null)} rodape={<Button disabled={busy} variant="secondary" onClick={() => setSelected(null)}>{embedded ? 'Voltar' : 'Fechar'}</Button>}>
      <p>Competência {competencia} · {labels[current.status]}</p>
      {stage === 'confirmado' && <p>Confirmação: {confirmation[selected]?.by || 'Autor não disponível'} · {operationInstant(confirmation[selected]?.at)}</p>}
      <p>Imposto salvo: {money(current.calculation?.dasValor)}</p><CalculationEvidence details={current.details} />
      {current.blocked && <p role="alert">{current.blocked}</p>}
      {evidenceError && <p role="alert">{evidenceError}. Confirmar e liberar estão indisponíveis até atualizar as evidências.</p>}
      <Button variant="secondary" disabled={busy || reading} onClick={refreshEvidence}>Atualizar evidências</Button>
      {current.execution && <p role="status">{current.execution.message || 'Acompanhe os detalhes e documentos em Tarefas.'}</p>}
      {current.pending.map(p => <p key={p.id}>{p.observacoes || p.motivo}</p>)}
      {!busy && <div className="operacoes-acoes"><InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(selected, 'cadastroFiscal')}?competencia=${competencia}`}>Abrir central de apuração</InternalLink><InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(selected, 'auditoria')}?competencia=${competencia}`}>Revisar notas da competência</InternalLink></div>}
      {!canEditCurrent && <p role="status">Seu acesso permite somente consultar esta apuração.</p>}
      {canEditCurrent && <><p>Confirme somente após conferir o cálculo salvo, faturamento, anexos e divergências. Confirmar registra sua conferência; não transmite. A liberação exige outra prévia explícita.</p>
      <div className="operacoes-acoes"><Button disabled={busy || reading || !!approvalEvidenceError(current) || !!current.blocked || (current.execution && current.execution.status !== 'DONE') || current.status === 'RELEASED'} onClick={() => change([current], 'confirm')}>Confirmar apuração</Button><Button variant="secondary" disabled={busy} onClick={() => change([current], 'review')}>Marcar para revisão</Button></div>
      {current.status === 'RELEASED' && !evidenceError && !current.blocked && !current.execution && <Button disabled={busy} onClick={() => { setBatch([current]); setSelected(null); }}>Executar liberação</Button>}
      <div className="operacoes-programacao"><label>Programar conferência <input type="datetime-local" value={schedule} disabled={busy} onChange={e => setSchedule(e.target.value)} /></label>
      <Button variant="secondary" disabled={busy} onClick={() => change([current], 'schedule')}>Salvar programação</Button></div></>}
    </ApprovalDialog>}
    {batch && <ApprovalDialog focusRef={detailRef} embedded={embedded} className="operacoes-dialogo" titulo="Liberar apurações confirmadas" ocupado={busy} aoFechar={() => { if (!busy) { setBatch(null); setConfirmCompetencia(''); } }} rodape={<><Button variant="secondary" disabled={busy} onClick={() => { setBatch(null); setConfirmCompetencia(''); }}>Cancelar</Button><Button disabled={busy || !canReleaseBatch || confirmCompetencia !== competencia} onClick={() => change(batch, 'release')}>Liberar e executar</Button></>}>
      {!canReleaseBatch && <p role="alert">Acesso, revisão ou evidências indisponíveis. Atualize as empresas antes de liberar.</p>}
      <p>Serão revalidadas {batch.length} apurações da competência {competencia}. A ação pode transmitir declarações e buscar documentos faltantes. Dados alterados, notas pendentes ou procuração inválida bloqueiam a execução. DAS e extratos completos serão reutilizados. Retificações não são automáticas.</p>
      <p>Esta continuação não envia guias ao cliente nem importa lançamentos no ERP. Se uma tentativa anterior terminou sem documento ou com resultado incerto, confira Tarefas e a apuração antes de repetir; esta ação não é uma recuperação documental independente.</p>
      <ul>{batch.map(item => <li key={item.companyId}>{rows.find(r => r.company.companyId === item.companyId)?.company.razao || item.companyId}</li>)}</ul>
      <div className="operacoes-programacao"><label>Digite a competência {competencia} para executar<input value={confirmCompetencia} disabled={busy} onChange={e => setConfirmCompetencia(e.target.value)} placeholder="AAAA-MM" /></label></div>
    </ApprovalDialog>}
  </section>;
}
