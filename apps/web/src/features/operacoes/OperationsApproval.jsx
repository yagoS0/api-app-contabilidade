import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { CalculationEvidence } from './OperationsCalculationDetails';
import { readCalculationDetails, approvalEvidenceError, operationDate, operationMoney as money } from './operationsDetails';

const labels = { PENDING: 'A conferir', IN_REVIEW: 'Em revisão', CONFIRMED: 'Confirmada', INVALIDATED: 'Dados alterados · revisar', RELEASED: 'Liberada · aguardando execução', EXECUTED: 'Execução concluída', ATTENTION: 'Conferir resultado em Tarefas' };

function ApprovalDialog({ embedded, titulo, children, rodape, focusRef, ...props }) {
  return embedded ? <section className="operacoes-conferencia-detalhe" aria-label={titulo}><h3 ref={focusRef} tabIndex={-1}>{titulo}</h3>{children}<div className="operacoes-acoes operacoes-destinos">{rodape}</div></section> : <Modal titulo={titulo} {...props} rodape={rodape}>{children}</Modal>;
}

export function OperationsApproval({ api, rows, competencia, onChanged, onBusyChange, embedded = false }) {
  const [data, setData] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null), [schedule, setSchedule] = useState(''), [batch, setBatch] = useState(null);
  const [version, setVersion] = useState(0), [message, setMessage] = useState('');
  const [checked, setChecked] = useState({});
  const context = useRef({ api, competencia });
  if (context.current.api !== api || context.current.competencia !== competencia) context.current = { api, competencia };
  useEffect(() => {
    context.current = { api, competencia };
    return () => { context.current = { api: null, competencia: null }; };
  }, [api, competencia]);
  const lock = useRef(false);
  const detailRef = useRef(null), triggerRefs = useRef(new Map()), batchRef = useRef(null), refreshRef = useRef(null);
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
  useEffect(() => {
    let active = true;
    setData({}); setChecked({}); setBatch(null); setSelected(null); setConfirmCompetencia(''); setError(''); setReading(true);
    if (!api?.getCompanyOperation) return;
    // Leituras exclusivamente locais, sequenciais para limitar carga na carteira.
    (async () => {
      for (const id of ids.split('|').filter(Boolean)) {
        try {
          const value = await api.getCompanyOperation(id, competencia);
          if (!active) return;
          if (!value || value.ok === false || value.companyId !== id || value.competencia !== competencia || !value.revision || !Array.isArray(value.pending)) throw Error('Conferência indisponível.');
          const details = await readCalculationDetails(api, id, competencia);
          if (!active) return;
          setData(old => ({ ...old, [id]: { ...value, details } }));
        } catch { if (active) setError('Algumas empresas não puderam ser conferidas. Atualize antes de liberar.'); }
        if (!active) return;
      }
      if (active) setReading(false);
    })();
    return () => { active = false; };
  }, [api, ids, competencia, version]);
  if (!api?.getCompanyOperation) return <p role="alert">Conferência indisponível neste ambiente. Abra a apuração da empresa para conferir os dados.</p>;
  const sorted = [...rows].sort((a, b) => (data[a.company.companyId]?.schedule || '9999').localeCompare(data[b.company.companyId]?.schedule || '9999'));
  const row = rows.find(r => r.company.companyId === selected);
  const current = data[selected];
  const canEditCurrent = writable.current.has(selected);
  const evidenceError = current ? approvalEvidenceError(current, { historical: true }) : null;
  const canReleaseBatch = batch?.every(item => writable.current.has(item.companyId) && item.competencia === competencia && data[item.companyId]?.revision === item.revision && !data[item.companyId]?.blocked && !approvalEvidenceError(data[item.companyId]));
  const confirmed = Object.values(data).filter(v => v.status === 'CONFIRMED' && !approvalEvidenceError(v) && !v.blocked && (!v.execution || v.execution.status === 'DONE') && writable.current.has(v.companyId));
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
  return <section aria-label="Conferência e programação de Operações">
    {!(embedded && ((row && current) || batch)) && <><div className="operacoes-cabecalho"><h3>Apurações da competência</h3><div className="operacoes-acoes"><Button ref={refreshRef} variant="secondary" disabled={busy || reading} onClick={() => setVersion(v => v + 1)}>Atualizar conferências</Button>{writable.current.size > 0 && <><Button variant="secondary" disabled={busy || reading || !confirmed.length || !!error} onClick={() => setChecked(Object.fromEntries(confirmed.map(v => [v.companyId, v.revision])))}>Selecionar elegíveis ({confirmed.length})</Button><Button ref={batchRef} disabled={busy || reading || !chosen.length || !!error} onClick={() => { returnTo.current = 'batch'; setBatch(chosen.map(v => ({ ...v }))); }}>Liberar selecionadas ({chosen.length})</Button></>}</div></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="operacoes-tabela-scroll" role="region" aria-label="Conferência das empresas" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th className="operacoes-coluna-selecao">Selecionar</th><th>Empresa</th><th>Cálculo salvo</th><th>Faturamento salvo</th><th>Anexo do formulário</th><th>Conferência e pendências</th><th>Ação</th></tr></thead><tbody>{sorted.map(({ company }) => { const d = data[company.companyId], name = company.razao || company.razaoSocial || company.cnpj; return <tr key={company.companyId}><td className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name}`} disabled={busy || reading || !confirmed.some(v => v.companyId === company.companyId)} checked={Boolean(d && checked[company.companyId] === d.revision)} onChange={e => setChecked(old => ({ ...old, [company.companyId]: e.target.checked ? d.revision : null }))} /></label></td><th scope="row">{name}</th><td>{money(d?.calculation?.dasValor)}</td><td>Interno: {money(d?.details?.snapshot?.value?.receitaInterna)}<br />Externo: {money(d?.details?.snapshot?.value?.receitaExterna)}</td><td>{d?.details?.snapshot?.value?.atividadesEscolhidas?.map(a => a.anexoImplicito ?? 'Não registrado').join(' · ') || 'Não disponível no snapshot'}</td><td>{d ? `${d.schedule ? operationDate(d.schedule) + ' · ' + d.schedule.slice(11,16) : 'Sem programação'} · ${labels[d.status] || 'A verificar'}${d.pending.length ? ` · ${d.pending.length} pendência(s) do período` : ''}` : reading ? 'Conferindo…' : 'Conferência indisponível'}{d?.blocked && <p>{d.blocked}</p>}{d && approvalEvidenceError(d, { historical: true }) && <p role="alert">{approvalEvidenceError(d, { historical: true })}. Atualize a conferência ou abra a empresa para verificar.</p>}<p>Auditoria: {d?.details?.auditoria?.value ? `${d.details.auditoria.value.totalAchados ?? 'A verificar'} achados` : 'Indisponível; não equivale a aprovação'}</p></td><td><Button ref={el => { if (el) triggerRefs.current.set(company.companyId, el); else triggerRefs.current.delete(company.companyId); }} size="sm" variant="secondary" disabled={!d || busy || reading} onClick={() => { returnTo.current = company.companyId; setSelected(company.companyId); setSchedule(d.schedule || ''); }}>Conferir</Button></td></tr>; })}</tbody></table></div></>}
    {row && current && <ApprovalDialog focusRef={detailRef} embedded={embedded} className="operacoes-dialogo" titulo={`Conferir ${row.company.razao || row.company.razaoSocial || row.company.cnpj}`} ocupado={busy} aoFechar={() => !busy && setSelected(null)} rodape={<Button disabled={busy} variant="secondary" onClick={() => setSelected(null)}>{embedded ? 'Voltar' : 'Fechar'}</Button>}>
      <p>Competência {competencia} · {labels[current.status]}</p>
      <p>Imposto salvo: {money(current.calculation?.dasValor)}</p><CalculationEvidence details={current.details} />
      {current.blocked && <p role="alert">{current.blocked}</p>}
      {evidenceError && <p role="alert">{evidenceError}. Confirmar e liberar estão indisponíveis até atualizar as evidências.</p>}
      <Button variant="secondary" disabled={busy || reading} onClick={() => setVersion(v => v + 1)}>Atualizar evidências</Button>
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
