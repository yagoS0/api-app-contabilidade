import { Fs12DeclaratoriaPanel } from '../apuracao/components/Fs12DeclaratoriaPanel';
import '../apuracao/components/fechamento-modal.css';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { operationMoney, calculationAuditLabel } from './operationsDetails';

const statusLabels = { CALCULADO: 'Calculado', CALCULATED: 'Calculado', COLLECTING: 'Coletando NFS-e', CALCULATING: 'Calculando', REVIEW: 'Revisão necessária', UNCERTAIN: 'Resultado a conferir', INCERTO: 'Resultado a conferir', INDETERMINADO: 'Resultado a conferir', REVISAO_NECESSARIA: 'Revisão necessária', BLOCKED: 'Bloqueada', ERROR: 'Falha', COLETA_PARCIAL: 'Coleta incompleta' };
const validIdentity = (value, item, competencia) => value && value.ok !== false && value.companyId === item.companyId && value.competencia === competencia;

// Each explicit command retains its identity. Reloading a result never repeats a POST.
export function OperationsCalculationBatch(props) {
  return <CalculationPreparation key={`${props.competencia}:${props.items.map(item => item.companyId).join('|')}`} {...props} />;
}
function CalculationPreparation({ api, items, competencia, footerTarget, onClose, onChanged, onBusyChange, onPrepareIndividual, disabled = false, canWrite = () => true }) {
  const [values, setValues] = useState({});
  const [zeroConfirmed, setZeroConfirmed] = useState({});
  const [fs12Item, setFs12Item] = useState(null), [fs12Busy, setFs12Busy] = useState(false);
  const fs12Heading = useRef(null), fs12Triggers = useRef(new Map()), fs12Changed = useRef(false);
  useEffect(() => { if (fs12Item) fs12Heading.current?.focus(); }, [fs12Item]);
  const [busy, setBusy] = useState(true);
  const [phase, setPhase] = useState('preview');
  const [message, setMessage] = useState('');
  const [closingItem,setClosingItem] = useState(null);
  const heading = useRef(null), origin = useRef(null), lock = useRef(false);
  const resultHeading = useRef(null);
  const commandIds = useRef(new Map());
  const access = useRef(canWrite); access.current = canWrite;
  useEffect(() => { onBusyChange?.(busy || fs12Busy); return () => onBusyChange?.(false); }, [busy, fs12Busy, onBusyChange]);
  useEffect(() => {
    const context = { api, competencia, items }; origin.current = context;
    heading.current?.focus();
    setFs12Item(null); setFs12Busy(false); fs12Changed.current = false;
    setClosingItem(null); setZeroConfirmed({}); setValues({}); setPhase('preview'); setBusy(true); setMessage(''); commandIds.current.clear();
    const active = () => origin.current === context;
    (async () => {
      for (const item of items) {
        if (!active()) return;
        try {
          const value = await api.previewOperationsCalculation(item.companyId, competencia);
          if (!active()) return;
          if (!validIdentity(value, item, competencia) || !value.revision || typeof value.canCalculate !== 'boolean' || !Array.isArray(value.blockers)) throw Error('Prévia incompatível. Atualize antes de calcular.');
          const previous = value.lastAttempt;
          if (validIdentity(previous, item, competencia) && typeof previous.requestId === 'string' && previous.requestId.length > 0 && statusLabels[previous.status]) commandIds.current.set(item.companyId, previous.requestId);
          setValues(old => ({ ...old, [item.companyId]: value }));
        } catch (error) { if (active()) setValues(old => ({ ...old, [item.companyId]: { canCalculate: false, blockers: [error.message || 'Não foi possível preparar o cálculo.'] } })); }
      }
      if (active()) setBusy(false);
    })();
    return () => { origin.current = null; };
  }, [api, competencia, items]);
  async function reloadAfterFs12(confirmation) {
    if (!fs12Item || confirmation.portalClientId !== fs12Item.companyId || confirmation.competencia !== competencia) return;
    const context = origin.current, item = fs12Item;
    fs12Changed.current = true;
    setValues(old => ({ ...old, [item.companyId]: { ...old[item.companyId], canCalculate: false, blockers: ['Folha confirmada. Atualizando a prévia…'] } }));
    setBusy(true);
    try {
      const value = await api.previewOperationsCalculation(item.companyId, competencia);
      if (origin.current !== context) return;
      if (!validIdentity(value, item, competencia) || !value.revision || typeof value.canCalculate !== 'boolean' || !Array.isArray(value.blockers)) throw Error('Prévia incompatível. Atualize antes de calcular.');
      setValues(old => ({ ...old, [item.companyId]: value }));
    } catch (error) {
      if (origin.current === context) setValues(old => ({ ...old, [item.companyId]: { ...old[item.companyId], canCalculate: false, blockers: [error.message || 'Não foi possível atualizar a prévia.'] } }));
    } finally { if (origin.current === context) setBusy(false); }
  }
  function closeFs12() {
    if (busy || fs12Busy) return;
    const id = fs12Item.companyId;
    setFs12Item(null);
    requestAnimationFrame(() => fs12Triggers.current.get(id)?.focus());
  }
  function closePreparation() {
    if (busy || fs12Busy) return;
    if (fs12Changed.current) onChanged?.();
    onClose?.();
  }
  const eligible = items.filter(item => values[item.companyId]?.canCalculate === true);
  async function execute() {
    if (lock.current || busy || fs12Busy || fs12Item || phase !== 'preview' || !eligible.length) return;
    if (disabled) { setMessage('Atualize as empresas e as conferências antes de iniciar o cálculo.'); return; }
    const context = origin.current;
    lock.current = true; setBusy(true); setPhase('result'); setMessage('Coletando NFS-e, auditando e preparando os cálculos selecionados…');
    let changed = false;
    for (const item of items) {
      if (origin.current !== context) break;
      const preview = values[item.companyId];
      if (preview?.canCalculate !== true) continue;
      let dispatched = false;
      setValues(old => ({ ...old, [item.companyId]: { ...old[item.companyId], status: 'RUNNING' } }));
      try {
        if (!access.current(item.companyId)) throw Error('Seu acesso mudou. Atualize antes de calcular.');
        if (typeof crypto.randomUUID !== 'function') throw Error('Não foi possível preparar a identificação segura do cálculo. Nenhuma consulta foi iniciada.');
        const requestId = crypto.randomUUID(); commandIds.current.set(item.companyId, requestId);
        dispatched = true;
        const result = await api.executeOperationsCalculation(item.companyId, competencia, { expectedRevision: preview.revision, requestId, confirmCompetencia: competencia, ...(zeroConfirmed[item.companyId] ? { confirmSemMovimento: true } : {}) });
        if (origin.current !== context) break;
        if (!validIdentity(result, item, competencia) || result.requestId !== requestId || !statusLabels[result.status]) throw Error('Resultado não confirmado. Consulte a tentativa antes de continuar.');
        setValues(old => ({ ...old, [item.companyId]: { ...preview, ...result } }));
        changed = true;
      } catch (error) {
        if (origin.current === context) setValues(old => ({ ...old, [item.companyId]: { ...preview, status: dispatched ? 'INCERTO' : 'ERROR', reason: error.message || 'Resposta não confirmada. Confira a tentativa; não repita o cálculo.' } }));
      }
    }
    lock.current = false;
    if (origin.current === context) {
      setBusy(false); setMessage('Confira o resultado de cada empresa. A conferência dos cálculos exige uma nova seleção.');
      if (changed) onChanged?.();
      requestAnimationFrame(() => resultHeading.current?.focus());
    }
  }
  async function readResult(item, recover = false, closeUnsent = false) {
    if (lock.current || busy || !api.getOperationsCalculationResult || recover && (disabled || !access.current(item.companyId) || !api.reconcileOperationsCalculation)) return;
    const context = origin.current; lock.current = true; setBusy(true);
    try {
      const envelope = recover ? await api.reconcileOperationsCalculation(item.companyId, competencia, commandIds.current.get(item.companyId), closeUnsent) : await api.getOperationsCalculationResult(item.companyId, competencia, commandIds.current.get(item.companyId));
      if (origin.current !== context) return;
      const result = envelope?.attempt;
      if (!validIdentity(envelope, item, competencia) || !validIdentity(result, item, competencia) || !statusLabels[result?.status] || result.requestId !== commandIds.current.get(item.companyId)) throw Error('Resultado desta tentativa ainda indisponível.');
      setValues(old => ({ ...old, [item.companyId]: { ...old[item.companyId], ...result } })); setClosingItem(null); onChanged?.();
    } catch (error) { if (origin.current === context) setMessage(error.message || 'Não foi possível consultar a tentativa.'); }
    finally { lock.current = false; if (origin.current === context) setBusy(false); }
  }
  const footer = <div className="operacoes-stage-footer"><span>{phase === 'preview' ? `${eligible.length} aptas · ${items.length - eligible.length} bloqueadas` : `${items.length} selecionadas`}</span><Button variant="secondary" disabled={busy || fs12Busy} onClick={closePreparation}>Voltar</Button>{phase === 'preview' && <Button disabled={disabled || busy || !eligible.length} onClick={execute}>Confirmar cálculo ({eligible.length})</Button>}</div>;
  if (fs12Item) {
    const back = <div className="operacoes-stage-footer"><Button variant="secondary" disabled={busy || fs12Busy} onClick={closeFs12}>Voltar às empresas selecionadas</Button></div>;
    return <section className="operacoes-conferencia-detalhe" aria-label="Preparar folha em Operações">
      <h3 ref={fs12Heading} tabIndex={-1}>{fs12Item.name} · {competencia}</h3>
      <p>Confirmar a folha não calcula nem transmite.</p>
      <Fs12DeclaratoriaPanel key={`${fs12Item.companyId}:${competencia}`} api={api} portalClientId={fs12Item.companyId}
        competencia={competencia} razao={fs12Item.name} onConfirmed={reloadAfterFs12} onBusyChange={setFs12Busy}
        disabled={disabled || busy || !access.current(fs12Item.companyId)} />
      {busy && <p role="status">Atualizando a prévia após a confirmação da folha…</p>}
      {(values[fs12Item.companyId]?.blockers || []).map(reason => <p key={reason}>{reason}</p>)}
      {footerTarget ? createPortal(back, footerTarget) : back}
    </section>;
  }
  return <section aria-label="Cálculo de NFS-e selecionadas" className="operacoes-conferencia-detalhe">
    <h3 ref={heading} tabIndex={-1}>Calcular empresas selecionadas</h3>
    {closingItem && <section aria-label="Confirmar encerramento antes do despacho"><p>Encerrar a tentativa de {closingItem.name} · {competencia} somente se o servidor comprovar que ela não foi enviada. Isto impede o despacho futuro desta tentativa. Não cancela declaração transmitida.</p><Button variant="secondary" disabled={busy} onClick={() => setClosingItem(null)}>Voltar sem encerrar</Button><Button disabled={disabled || busy || !access.current(closingItem.companyId)} onClick={() => readResult(closingItem,true,true)}>Confirmar encerramento sem despacho</Button></section>}
    {phase === 'preview' && <p>Competência {competencia}. Busca de NFS-e e simulação do imposto podem consumir consultas. O cálculo não confirma nem transmite a apuração.</p>}
    {busy && <p role="status">{phase === 'preview' ? 'Preparando empresas selecionadas…' : 'Processando. Aguarde o resultado antes de repetir.'}</p>}
    {message && <p ref={resultHeading} tabIndex={-1} role="status">{message}</p>}
    <div className="operacoes-tabela-scroll" role="region" aria-label="Resultados do cálculo selecionado" tabIndex={0}><table className="operacoes-tabela operacoes-calculation-cards"><thead><tr><th>Empresa</th><th>Receita</th><th>Imposto</th><th>Auditoria / avisos</th><th>Resultado</th></tr></thead><tbody>{items.map(item => {
      const value = values[item.companyId], calculation = value?.calculation;
      const receita = calculation?.receita ?? (calculation?.receitaInterna != null && calculation?.receitaExterna != null ? Number(calculation.receitaInterna) + Number(calculation.receitaExterna) : null);
      return <tr key={item.companyId}><th scope="row">{item.name}</th><td data-label="Receita">{operationMoney(receita)}</td><td data-label="Imposto">{operationMoney(calculation?.imposto ?? calculation?.dasValor)}</td><td data-label="Auditoria / avisos">{calculationAuditLabel(value?.audit)}{(value?.warnings || []).map((warning, index) => <p key={index}>{typeof warning === 'string' ? warning : warning.message || warning.label}</p>)}</td><td data-label="Resultado">{value?.status ? statusLabels[value.status] || (value.status === 'RUNNING' ? 'Em processamento' : value.status) : value ? value.canCalculate ? 'Pronta para calcular' : 'Revisar' : 'Lendo…'}{value?.reason && <p role="alert">{value.reason}</p>}{(value?.blockers || []).map(reason => <p key={reason}>{reason}</p>)}{phase === 'preview' && value?.regime === 'SIMPLES' && receita === 0 && <label><input type="checkbox" checked={!!zeroConfirmed[item.companyId]} disabled={disabled || busy || !access.current(item.companyId)} onChange={e => setZeroConfirmed(old => ({ ...old, [item.companyId]: e.target.checked }))} />Conferi ausência de receita de {item.name} nesta competência. O servidor verificará a base completa.</label>}{phase === 'preview' && value?.regime === 'SIMPLES' && competencia >= '2026-11' && onPrepareIndividual && <Button variant="secondary" size="sm" disabled={disabled || busy || !access.current(item.companyId)} onClick={() => onPrepareIndividual(item)}>Preparar cálculo de {item.name}</Button>}{phase === 'preview' && competencia >= '2026-11' && value?.regime === 'SIMPLES' && <Button variant="secondary" size="sm" ref={node => { if (node) fs12Triggers.current.set(item.companyId, node); else fs12Triggers.current.delete(item.companyId); }} disabled={disabled || busy || !access.current(item.companyId)} onClick={() => setFs12Item(item)}>Preparar folha de {item.name}</Button>}{commandIds.current.has(item.companyId) && ['UNCERTAIN','CALCULATING'].includes(value?.status) && api.reconcileOperationsCalculation && <Button variant="secondary" size="sm" disabled={disabled || busy || !access.current(item.companyId)} onClick={() => readResult(item, true)}>Reconciliar cálculo sem reenviar</Button>}{commandIds.current.has(item.companyId) && ['UNCERTAIN','CALCULATING'].includes(value?.status) && api.reconcileOperationsCalculation && <Button variant="secondary" size="sm" disabled={disabled || busy || !access.current(item.companyId)} onClick={() => setClosingItem(item)}>Encerrar tentativa não enviada</Button>}{commandIds.current.has(item.companyId) && <Button variant="secondary" size="sm" disabled={busy || !api.getOperationsCalculationResult} onClick={() => readResult(item)}>Conferir resultado</Button>}</td></tr>;
    })}</tbody></table></div>
    {footerTarget ? createPortal(footer, footerTarget) : footer}
  </section>;
}
