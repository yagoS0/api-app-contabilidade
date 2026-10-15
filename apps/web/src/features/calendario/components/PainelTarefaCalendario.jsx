import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { dataBR } from '../lib/agendaWorkspace';

export const textoAlertaTarefa = alerta => ({ AMANHA:'Vence amanhã', HOJE:'Vence hoje', ATRASADA:'Atrasada' }[alerta] || '');
export const empresaConcluida = empresa => empresa.subtarefas?.length ? empresa.subtarefas.every(s => s.concluida) : Boolean(empresa.concluida || empresa.concluidaEm);
function alertaAtual(vencimento) {
  if (!vencimento) return '';
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const amanha = new Date(`${hoje}T12:00:00Z`); amanha.setUTCDate(amanha.getUTCDate() + 1);
  return vencimento < hoje ? 'ATRASADA' : vencimento === hoje ? 'HOJE' : vencimento === amanha.toISOString().slice(0,10) ? 'AMANHA' : '';
}
const linhasDe = item => item.empresas?.length ? item.empresas : [{ companyId:null, nome:'Tarefa', subtarefas:item.subtarefas || [], concluida:Boolean(item.concluidaEm || item.resolvido) }];
function atualizar(item, companyId, subtarefaId, concluida) {
  const empresas = linhasDe(item).map(empresa => {
    if ((empresa.companyId ?? null) !== companyId) return empresa;
    const alterada = { ...empresa, ...(subtarefaId ? { subtarefas:empresa.subtarefas.map(s => s.id === subtarefaId ? { ...s, concluida } : s) } : { concluida, concluidaEm:concluida ? new Date().toISOString() : null }) };
    alterada.concluida = empresaConcluida(alterada);
    return alterada;
  });
  const completa = empresas.every(empresaConcluida);
  return { ...item, empresas:item.empresas?.length ? empresas : [], subtarefas:item.empresas?.length ? item.subtarefas : empresas[0].subtarefas, concluidaEm:completa ? new Date().toISOString() : null, resolvido:completa };
}

export function PainelTarefaCalendario({ item, api, onFechar, onChanged, onEditar, onExcluir, onOpenCompany }) {
  const original = item.atividadeOriginal || item;
  const [atual, setAtual] = useState(original);
  const confirmado = useRef(original);
  const [pendentes, setPendentes] = useState(false);
  const [salvando, setSalvando] = useState(new Set());
  const locks = useRef(new Set());
  const [erros, setErros] = useState({});
  useEffect(() => { if (!locks.current.size) { confirmado.current = original; setAtual(original); } }, [original]);
  const empresas = linhasDe(atual);
  const concluidas = empresas.filter(empresaConcluida).length;
  const pessoal = !atual.empresas?.length;
  const alerta = concluidas === empresas.length ? '' : textoAlertaTarefa(item.alertaVencimento || alertaAtual(atual.dataVencimento));
  const hora = atual.horarioModo === 'ATE' || atual.config?.horarioModo === 'ATE' ? `Até ${atual.horaLimite || atual.config?.horaLimite || ''}` : atual.horaInicio ? `Às ${atual.horaInicio}` : '';
  async function marcar(empresa, subtarefa, valor) {
    const companyId = empresa.companyId ?? null;
    const chave = companyId || 'pessoal';
    if (locks.current.has(chave)) return;
    locks.current.add(chave); setSalvando(new Set(locks.current));
    setErros(e => ({ ...e, [chave]:'' }));
    setAtual(a => atualizar(a, companyId, subtarefa?.id, valor));
    try {
      const resposta = await api.acaoTarefaCalendario(atual.tarefaId || atual.id, { acao:subtarefa ? 'SUBTAREFA' : valor ? 'CONCLUIR' : 'REABRIR', cicloChave:atual.cicloChave, companyId, ...(subtarefa ? { subtarefaId:subtarefa.id, concluida:valor } : {}) });
      if (resposta?.ok === false) throw new Error(resposta.error || resposta.message || 'Não foi possível salvar.');
      confirmado.current = atualizar(confirmado.current, companyId, subtarefa?.id, valor);
      onChanged?.(confirmado.current);
    } catch (erro) {
      const anterior = linhasDe(confirmado.current).find(e => (e.companyId ?? null) === companyId);
      setAtual(a => atualizar(a, companyId, subtarefa?.id, subtarefa ? Boolean(anterior?.subtarefas?.find(s => s.id === subtarefa.id)?.concluida) : empresaConcluida(anterior || {})));
      setErros(e => ({ ...e, [chave]:erro.message || 'Não foi possível salvar. Tente novamente.' }));
    } finally { locks.current.delete(chave); setSalvando(new Set(locks.current)); }
  }
  return <Modal titulo={atual.titulo} aoFechar={onFechar} lateral ocupado={salvando.size > 0} className="agenda-task-panel" rodape={<div className="agenda-task-panel-actions">{onExcluir && <Button variant="secondary" disabled={salvando.size > 0} onClick={() => onExcluir(atual)}>Excluir</Button>}{onEditar && <Button variant="secondary" disabled={salvando.size > 0} onClick={() => onEditar(atual)}>Editar tarefa</Button>}</div>}>
    <p className="agenda-task-panel-period">{dataBR(atual.dataInicio)}{atual.dataFim && atual.dataFim !== atual.dataInicio ? ` – ${dataBR(atual.dataFim)}` : ''}{hora && ` · ${hora}`}</p>
    {atual.descricao && <p className="agenda-task-panel-description">{atual.descricao}</p>}
    {atual.dataVencimento && concluidas < empresas.length && <p className={`agenda-task-deadline${alerta ? ' is-urgent' : ''}`}><span aria-hidden="true">⚑</span>{alerta ? `${alerta} · ` : 'Vencimento · '}{dataBR(atual.dataVencimento)}</p>}
    <div className="agenda-task-progress"><div><strong>{pessoal ? 'Andamento' : 'Empresas'}</strong><span aria-live="polite">{concluidas} de {empresas.length} concluída{empresas.length > 1 ? 's' : ''}</span></div><progress value={concluidas} max={empresas.length} aria-label="Progresso da tarefa" /></div>
    {!pessoal && <div className="agenda-task-filters" aria-label="Filtrar empresas"><Button variant="secondary" size="sm" aria-pressed={!pendentes} onClick={() => setPendentes(false)}>Todas</Button><Button variant="secondary" size="sm" aria-pressed={pendentes} onClick={() => setPendentes(true)}>Pendentes</Button></div>}
    <div className="agenda-task-companies">{empresas.filter(e => !pendentes || !empresaConcluida(e)).map(empresa => {
      const chave = empresa.companyId || 'pessoal';
      const completa = empresaConcluida(empresa);
      const subtarefas = empresa.subtarefas || [];
      return <section key={chave} className={`agenda-task-company${completa ? ' is-complete' : ''}`} aria-label={empresa.nome || empresa.companyId || 'Tarefa'} aria-busy={salvando.has(chave)}>
        <div className="agenda-task-company-heading"><strong>{empresa.nome || empresa.companyId || 'Tarefa'}</strong><span>{subtarefas.length ? `${subtarefas.filter(s => s.concluida).length}/${subtarefas.length}` : completa ? 'Concluída' : 'Pendente'}</span></div>
        {subtarefas.length ? subtarefas.map(s => <label className="agenda-task-check" key={s.id}><input type="checkbox" checked={Boolean(s.concluida)} disabled={salvando.has(chave)} onChange={e => marcar(empresa, s, e.target.checked)} /><span>{s.titulo}</span></label>) : <label className="agenda-task-check"><input type="checkbox" checked={completa} disabled={salvando.has(chave)} onChange={e => marcar(empresa, null, e.target.checked)} /><span>{completa ? 'Reabrir' : 'Concluir'} {pessoal ? 'tarefa' : 'empresa'}</span></label>}
        {salvando.has(chave) && <small role="status">Salvando…</small>}{erros[chave] && <p className="agenda-error" role="alert">{erros[chave]}</p>}
        {empresa.companyId && onOpenCompany && <Button variant="secondary" size="sm" onClick={() => onOpenCompany(empresa.companyId)}>Abrir empresa</Button>}
      </section>;
    })}{pendentes && concluidas === empresas.length && <p className="agenda-empty">Todas as empresas concluídas.</p>}</div>
  </Modal>;
}
