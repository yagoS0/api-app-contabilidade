import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { operationMoney, calculationAuditLabel } from './operationsDetails';

const statusLabels = { CALCULADO: 'Calculado', CALCULATED: 'Calculado', COLLECTING: 'Coletando NFS-e', CALCULATING: 'Calculando', REVIEW: 'Revisão necessária', UNCERTAIN: 'Resultado a conferir', INCERTO: 'Resultado a conferir', INDETERMINADO: 'Resultado a conferir', REVISAO_NECESSARIA: 'Revisão necessária', BLOCKED: 'Bloqueada', ERROR: 'Falha', COLETA_PARCIAL: 'Coleta incompleta' };
const validIdentity = (value, item, competencia) => value && value.ok !== false && value.companyId === item.companyId && value.competencia === competencia;

// Each explicit command retains its identity. Reloading a result never repeats a POST.
export function OperationsCalculationBatch({ api, items, competencia, footerTarget, onClose, onChanged, onBusyChange, canWrite = () => true }) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(true);
  const [phase, setPhase] = useState('preview');
  const [message, setMessage] = useState('');
  const heading = useRef(null), origin = useRef(null), lock = useRef(false);
  const resultHeading = useRef(null);
  const commandIds = useRef(new Map());
  const access = useRef(canWrite); access.current = canWrite;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    const context = { api, competencia, items }; origin.current = context;
    heading.current?.focus();
    setValues({}); setPhase('preview'); setBusy(true); setMessage(''); commandIds.current.clear();
    const active = () => origin.current === context;
    (async () => {
      for (const item of items) {
        if (!active()) return;
        try {
          const value = await api.previewOperationsCalculation(item.companyId, competencia);
          if (!active()) return;
          if (!validIdentity(value, item, competencia) || !value.revision || !Array.isArray(value.blockers)) throw Error('Prévia incompatível. Atualize antes de calcular.');
          const previous = value.lastAttempt;
          if (validIdentity(previous, item, competencia) && typeof previous.requestId === 'string' && previous.requestId.length > 0 && statusLabels[previous.status]) commandIds.current.set(item.companyId, previous.requestId);
          setValues(old => ({ ...old, [item.companyId]: value }));
        } catch (error) { if (active()) setValues(old => ({ ...old, [item.companyId]: { canCalculate: false, blockers: [error.message || 'Não foi possível preparar o cálculo.'] } })); }
      }
      if (active()) setBusy(false);
    })();
    return () => { origin.current = null; };
  }, [api, competencia, items]);
  const eligible = items.filter(item => values[item.companyId]?.canCalculate === true);
  async function execute() {
    if (lock.current || busy || phase !== 'preview' || !eligible.length) return;
    const context = origin.current;
    lock.current = true; setBusy(true); setPhase('result'); setMessage('Coletando NFS-e, auditando e preparando os cálculos selecionados…');
    let changed = false;
    for (const item of items) {
      if (origin.current !== context) break;
      const preview = values[item.companyId];
      if (!preview?.canCalculate) continue;
      const requestId = crypto.randomUUID(); commandIds.current.set(item.companyId, requestId);
      setValues(old => ({ ...old, [item.companyId]: { ...old[item.companyId], status: 'RUNNING' } }));
      try {
        if (!access.current(item.companyId)) throw Error('Seu acesso mudou. Atualize antes de calcular.');
        const result = await api.executeOperationsCalculation(item.companyId, competencia, { expectedRevision: preview.revision, requestId, confirmCompetencia: competencia });
        if (origin.current !== context) break;
        if (!validIdentity(result, item, competencia) || result.requestId !== requestId || !statusLabels[result.status]) throw Error('Resultado não confirmado. Consulte a tentativa antes de continuar.');
        setValues(old => ({ ...old, [item.companyId]: { ...preview, ...result } }));
        changed = true;
      } catch (error) {
        if (origin.current === context) setValues(old => ({ ...old, [item.companyId]: { ...preview, status: 'INCERTO', reason: error.message || 'Resposta não confirmada. Confira a tentativa; não repita o cálculo.' } }));
      }
    }
    lock.current = false;
    if (origin.current === context) {
      setBusy(false); setMessage('Confira o resultado de cada empresa. A conferência dos cálculos exige uma nova seleção.');
      if (changed) onChanged?.();
      requestAnimationFrame(() => resultHeading.current?.focus());
    }
  }
  async function readResult(item) {
    if (lock.current || busy || !api.getOperationsCalculationResult) return;
    const context = origin.current; lock.current = true; setBusy(true);
    try {
      const envelope = await api.getOperationsCalculationResult(item.companyId, competencia, commandIds.current.get(item.companyId));
      if (origin.current !== context) return;
      const result = envelope?.attempt;
      if (!validIdentity(envelope, item, competencia) || !validIdentity(result, item, competencia) || !statusLabels[result?.status] || result.requestId !== commandIds.current.get(item.companyId)) throw Error('Resultado desta tentativa ainda indisponível.');
      setValues(old => ({ ...old, [item.companyId]: { ...old[item.companyId], ...result } })); onChanged?.();
    } catch (error) { if (origin.current === context) setMessage(error.message || 'Não foi possível consultar a tentativa.'); }
    finally { lock.current = false; if (origin.current === context) setBusy(false); }
  }
  const footer = <div className="operacoes-stage-footer"><span>{phase === 'preview' ? `${eligible.length} aptas · ${items.length - eligible.length} bloqueadas` : `${items.length} selecionadas`}</span><Button variant="secondary" disabled={busy} onClick={onClose}>Voltar</Button>{phase === 'preview' && <Button disabled={busy || !eligible.length} onClick={execute}>Confirmar cálculo ({eligible.length})</Button>}</div>;
  return <section aria-label="Cálculo de NFS-e selecionadas" className="operacoes-conferencia-detalhe">
    <h3 ref={heading} tabIndex={-1}>Calcular empresas selecionadas</h3>
    {phase === 'preview' && <p>Competência {competencia}. Busca de NFS-e e simulação do imposto podem consumir consultas. O cálculo não confirma nem transmite a apuração.</p>}
    {busy && <p role="status">{phase === 'preview' ? 'Preparando empresas selecionadas…' : 'Processando. Aguarde o resultado antes de repetir.'}</p>}
    {message && <p ref={resultHeading} tabIndex={-1} role="status">{message}</p>}
    <div className="operacoes-tabela-scroll" role="region" aria-label="Resultados do cálculo selecionado" tabIndex={0}><table className="operacoes-tabela operacoes-calculation-cards"><thead><tr><th>Empresa</th><th>Receita</th><th>Imposto</th><th>Auditoria / avisos</th><th>Resultado</th></tr></thead><tbody>{items.map(item => {
      const value = values[item.companyId], calculation = value?.calculation;
      const receita = calculation?.receita ?? (calculation?.receitaInterna != null && calculation?.receitaExterna != null ? Number(calculation.receitaInterna) + Number(calculation.receitaExterna) : null);
      return <tr key={item.companyId}><th scope="row">{item.name}</th><td data-label="Receita">{operationMoney(receita)}</td><td data-label="Imposto">{operationMoney(calculation?.imposto ?? calculation?.dasValor)}</td><td data-label="Auditoria / avisos">{calculationAuditLabel(value?.audit)}{(value?.warnings || []).map((warning, index) => <p key={index}>{typeof warning === 'string' ? warning : warning.message || warning.label}</p>)}</td><td data-label="Resultado">{value?.status ? statusLabels[value.status] || (value.status === 'RUNNING' ? 'Em processamento' : value.status) : value ? value.canCalculate ? 'Pronta para calcular' : 'Revisar' : 'Lendo…'}{value?.reason && <p role="alert">{value.reason}</p>}{(value?.blockers || []).map(reason => <p key={reason}>{reason}</p>)}{commandIds.current.has(item.companyId) && <Button variant="secondary" size="sm" disabled={busy || !api.getOperationsCalculationResult} onClick={() => readResult(item)}>Conferir resultado</Button>}</td></tr>;
    })}</tbody></table></div>
    {footerTarget ? createPortal(footer, footerTarget) : footer}
  </section>;
}
