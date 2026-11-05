import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';

export function OperationsExternalBatch({ api, items, competencia, taskKey, footerTarget, onClose, onChanged, onBusyChange, canWrite = () => true }) {
  const [values, setValues] = useState({}), [busy, setBusy] = useState(true), [done, setDone] = useState(false);
  const origin = useRef(null), lock = useRef(false), heading = useRef(null);
  const access = useRef(canWrite); access.current = canWrite;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    const context = { api, items, competencia, taskKey }; origin.current = context; setValues({}); setDone(false); setBusy(true); heading.current?.focus();
    (async () => {
      for (const item of items) {
        if (origin.current !== context) return;
        try {
          const value = await api.getOperationsExternal(item.companyId, competencia);
          if (origin.current !== context) return;
          if (value?.ok === false || value?.companyId !== item.companyId || value?.competencia !== competencia || value?.regime !== 'PRESUMIDO' || !Array.isArray(value.tasks)) throw Error('Referência externa incompatível. Atualize a empresa.');
          setValues(old => ({ ...old, [item.companyId]: value }));
        } catch (error) { if (origin.current === context) setValues(old => ({ ...old, [item.companyId]: { error: error.message || 'Leitura indisponível.' } })); }
      }
      if (origin.current === context) setBusy(false);
    })();
    return () => { origin.current = null; };
  }, [api, items, competencia, taskKey]);
  const task = value => value?.tasks?.find(entry => entry.chave === taskKey);
  const waiting = value => Array.isArray(value?.aguardando) ? value.aguardando.length > 0 : value?.aguardando === true;
  const eligible = item => {
    const value = values[item.companyId], current = task(value);
    return !value?.error && current && !current.concluida && Array.isArray(current.aguardando) && !waiting(current) && Number.isInteger(current.versao) && typeof current.hash === 'string' && current.hash;
  };
  const candidates = items.filter(eligible);
  async function confirm() {
    if (lock.current || busy || done || !candidates.length) return;
    const context = origin.current; lock.current = true; setBusy(true); setDone(true);
    for (const item of candidates) {
      if (origin.current !== context) break;
      const current = task(values[item.companyId]);
      try {
        if (!access.current(item.companyId)) throw Error('Seu acesso mudou. Atualize antes de registrar.');
        const result = await api.saveOperationsExternal(item.companyId, competencia, { chave: taskKey, versao: current.versao, hash: current.hash, confirmCompetencia: competencia });
        if (origin.current !== context) break;
        if (result?.ok === false || result?.companyId !== item.companyId || result?.competencia !== competencia || !task(result)?.concluida) throw Error('Gravação não confirmada. Atualize antes de repetir.');
        setValues(old => ({ ...old, [item.companyId]: result }));
      } catch (error) { if (origin.current === context) setValues(old => ({ ...old, [item.companyId]: { ...old[item.companyId], error: error.message || 'Resultado não confirmado.' } })); }
    }
    lock.current = false;
    if (origin.current === context) { setBusy(false); onChanged?.(); requestAnimationFrame(() => heading.current?.focus()); }
  }
  const footer = <div className="operacoes-stage-footer"><Button variant="secondary" disabled={busy} onClick={onClose}>Voltar</Button>{!done && <Button disabled={busy || !candidates.length} onClick={confirm}>Confirmar conclusão externa ({candidates.length})</Button>}</div>;
  return <section className="operacoes-conferencia-detalhe" aria-label="Conclusão externa do Lucro Presumido"><h3 ref={heading} tabIndex={-1}>{taskKey === 'apurar' ? 'Registrar apuração externa' : 'Registrar entrega externa'}</h3><p>Competência {competencia}. Sua confirmação registra usuário, data e revisão do trabalho feito fora da Altan. Não transmite declarações nem confirma pagamento.</p>{busy && <p role="status">{done ? 'Registrando conclusões…' : 'Conferindo tarefas externas…'}</p>}
    <div className="operacoes-tabela-scroll" role="region" aria-label="Trabalhos externos selecionados" tabIndex={0}><table className="operacoes-tabela operacoes-external-cards"><thead><tr><th>Empresa</th><th>Situação</th></tr></thead><tbody>{items.map(item => { const value = values[item.companyId], current = task(value); return <tr key={item.companyId}><th scope="row">{item.name}</th><td data-label="Situação">{value?.error ? <span role="alert">{value.error}</span> : current?.concluida ? 'Feita externamente' : waiting(current) ? `Aguardando: ${Array.isArray(current.aguardando) ? current.aguardando.join(' · ') : 'conclusão da apuração'}.` : eligible(item) ? 'Aguardando sua confirmação' : value ? 'Tarefa indisponível para conclusão' : 'Lendo…'}</td></tr>; })}</tbody></table></div>{footerTarget ? createPortal(footer, footerTarget) : footer}</section>;
}
