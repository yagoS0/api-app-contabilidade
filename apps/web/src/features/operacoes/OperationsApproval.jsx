import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';

const labels = { PENDING: 'A conferir', IN_REVIEW: 'Em revisão', CONFIRMED: 'Confirmada', INVALIDATED: 'Dados alterados · revisar', RELEASED: 'Liberada · aguardando execução', EXECUTED: 'Execução concluída', ATTENTION: 'Conferir resultado em Tarefas' };
const money = value => value == null ? 'Não disponível' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function ApprovalDialog({ embedded, titulo, children, rodape, focusRef, ...props }) {
  return embedded ? <section className="operacoes-conferencia-detalhe" aria-label={titulo}><h3 ref={focusRef} tabIndex={-1}>{titulo}</h3>{children}<div className="operacoes-acoes operacoes-destinos">{rodape}</div></section> : <Modal titulo={titulo} {...props} rodape={rodape}>{children}</Modal>;
}

export function OperationsApproval({ api, rows, competencia, onChanged, onBusyChange, embedded = false }) {
  const [data, setData] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null), [schedule, setSchedule] = useState(''), [batch, setBatch] = useState(null);
  const [version, setVersion] = useState(0), [message, setMessage] = useState('');
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
    setData({}); setError(''); setReading(true);
    if (!api?.getCompanyOperation) return;
    // Leituras exclusivamente locais, sequenciais para limitar carga na carteira.
    (async () => {
      for (const id of ids.split('|').filter(Boolean)) {
        try {
          const value = await api.getCompanyOperation(id, competencia);
          if (!active) return;
          setData(old => ({ ...old, [id]: value }));
        } catch { if (active) setError('Algumas empresas não puderam ser conferidas. Atualize antes de liberar.'); }
        if (!active) return;
      }
      if (active) setReading(false);
    })();
    return () => { active = false; };
  }, [api, ids, competencia, version]);
  if (!api?.getCompanyOperation) return null;
  const sorted = [...rows].sort((a, b) => (data[a.company.companyId]?.schedule || '9999').localeCompare(data[b.company.companyId]?.schedule || '9999'));
  const row = rows.find(r => r.company.companyId === selected);
  const current = data[selected];
  const canEditCurrent = writable.current.has(selected);
  const canReleaseBatch = batch?.every(item => writable.current.has(item.companyId));
  const confirmed = Object.values(data).filter(v => v.status === 'CONFIRMED' && !v.blocked && writable.current.has(v.companyId));
  async function change(items, action) {
    if (lock.current || items.some(item => !writable.current.has(item.companyId))) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    let count = 0;
    try {
      for (const item of items) {
        if (!writable.current.has(item.companyId)) throw Error('Seu acesso mudou. Esta empresa permite somente consulta.');
        let value = action === 'release' && item.status === 'RELEASED' ? item : await api.saveCompanyOperation(item.companyId, competencia, { action, expectedRevision: item.revision, requestId: crypto.randomUUID(), ...(action === 'schedule' ? { schedule: schedule || null } : {}) });
        if (action === 'release' && api.executeCompanyOperation) {
          if (!writable.current.has(item.companyId)) throw Error('Seu acesso mudou. Confira a liberação salva antes de continuar.');
          await api.executeCompanyOperation(item.companyId, competencia, value.revision);
          value = await api.getCompanyOperation(item.companyId, competencia);
        }
        setData(old => ({ ...old, [item.companyId]: value })); count++;
      }
      setMessage(action === 'release' ? `${count} liberação(ões) processada(s). Confira o resultado e os documentos em Tarefas.` : 'Alteração salva.');
      if (action === 'release') onChanged?.();
    } catch (e) {
      setError(`${count ? `${count} alteração(ões) salva(s). ` : ''}${e.message || 'Resultado não confirmado.'} Atualize os dados antes de tentar novamente.`);
      // Não reenviar depois de timeout; a leitura recupera o resultado persistido.
      setData({});
    } finally { lock.current = false; setBusy(false); setBatch(null); setSelected(null); setConfirmCompetencia(''); }
  }
  return <section aria-label="Conferência e programação de Operações">
    {!(embedded && ((row && current) || batch)) && <><div className="operacoes-cabecalho"><h3>Apurações da competência</h3><div className="operacoes-acoes"><Button ref={refreshRef} variant="secondary" disabled={busy || reading} onClick={() => setVersion(v => v + 1)}>Atualizar conferências</Button>{writable.current.size > 0 && <Button ref={batchRef} disabled={busy || reading || !confirmed.length || !!error} onClick={() => { returnTo.current = 'batch'; setBatch(confirmed.map(v => ({ ...v }))); }}>Liberar confirmadas ({confirmed.length})</Button>}</div></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <ul className="operacoes-tarefas">{sorted.map(({ company }) => { const d = data[company.companyId]; return <li key={company.companyId}><strong>{company.razao || company.razaoSocial || company.cnpj}</strong><span>{d ? `${d.schedule?.replace('T', ' · ') || 'Sem programação'} · ${labels[d.status]}${d.pending.length ? ` · ${d.pending.length} pendência(s) do período` : ''}` : reading ? 'Conferindo…' : 'Conferência indisponível'}</span><Button ref={el => { if (el) triggerRefs.current.set(company.companyId, el); else triggerRefs.current.delete(company.companyId); }} size="sm" variant="secondary" disabled={!d || busy || reading} onClick={() => { returnTo.current = company.companyId; setSelected(company.companyId); setSchedule(d.schedule || ''); }}>Conferir</Button></li>; })}</ul></>}
    {row && current && <ApprovalDialog focusRef={detailRef} embedded={embedded} className="operacoes-dialogo" titulo={`Conferir ${row.company.razao || row.company.razaoSocial || row.company.cnpj}`} ocupado={busy} aoFechar={() => !busy && setSelected(null)} rodape={<Button disabled={busy} variant="secondary" onClick={() => setSelected(null)}>{embedded ? 'Voltar' : 'Fechar'}</Button>}>
      <p>Competência {competencia} · {labels[current.status]}</p>
      <p>Imposto salvo: {money(current.calculation?.dasValor)}</p>
      {current.blocked && <p role="alert">{current.blocked}</p>}
      {current.execution && <p role="status">{current.execution.message || 'Acompanhe os detalhes e documentos em Tarefas.'}</p>}
      {current.pending.map(p => <p key={p.id}>{p.observacoes || p.motivo}</p>)}
      {!busy && <div className="operacoes-acoes"><InternalLink href={`${companyTabPath(selected, 'cadastroFiscal')}?competencia=${competencia}`}>Abrir central de apuração</InternalLink><InternalLink href={`${companyTabPath(selected, 'auditoria')}?competencia=${competencia}`}>Revisar notas da competência</InternalLink></div>}
      {!canEditCurrent && <p role="status">Seu acesso permite somente consultar esta apuração.</p>}
      {canEditCurrent && <><p>Confira faturamento, anexos e divergências na central de apuração antes de confirmar o cálculo salvo.</p>
      <div className="operacoes-acoes"><Button disabled={busy || !!current.blocked || current.status === 'RELEASED'} onClick={() => change([current], 'confirm')}>Confirmar apuração</Button><Button variant="secondary" disabled={busy} onClick={() => change([current], 'review')}>Marcar para revisão</Button></div>
      {current.status === 'RELEASED' && !current.blocked && !current.execution && <Button disabled={busy} onClick={() => { setBatch([current]); setSelected(null); }}>Executar liberação</Button>}
      <div className="operacoes-programacao"><label>Programar conferência <input type="datetime-local" value={schedule} disabled={busy} onChange={e => setSchedule(e.target.value)} /></label>
      <Button variant="secondary" disabled={busy} onClick={() => change([current], 'schedule')}>Salvar programação</Button></div></>}
    </ApprovalDialog>}
    {batch && <ApprovalDialog focusRef={detailRef} embedded={embedded} className="operacoes-dialogo" titulo="Liberar apurações confirmadas" ocupado={busy} aoFechar={() => { if (!busy) { setBatch(null); setConfirmCompetencia(''); } }} rodape={<><Button variant="secondary" disabled={busy} onClick={() => { setBatch(null); setConfirmCompetencia(''); }}>Cancelar</Button><Button disabled={busy || !canReleaseBatch || confirmCompetencia !== competencia} onClick={() => change(batch, 'release')}>Liberar e executar</Button></>}>
      {!canReleaseBatch && <p role="alert">Seu acesso mudou. Atualize as empresas antes de liberar.</p>}
      <p>Serão revalidadas {batch.length} apurações da competência {competencia}. A ação pode transmitir declarações e buscar documentos faltantes. Dados alterados, notas pendentes ou procuração inválida bloqueiam a execução. DAS e extratos completos serão reutilizados. Retificações não são automáticas.</p>
      <ul>{batch.map(item => <li key={item.companyId}>{rows.find(r => r.company.companyId === item.companyId)?.company.razao || item.companyId}</li>)}</ul>
      <div className="operacoes-programacao"><label>Digite a competência {competencia} para executar<input value={confirmCompetencia} disabled={busy} onChange={e => setConfirmCompetencia(e.target.value)} placeholder="AAAA-MM" /></label></div>
    </ApprovalDialog>}
  </section>;
}
