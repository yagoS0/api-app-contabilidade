import { useEffect, useRef, useState } from 'react';
import { corAtividade, dataBR, horarioAtividade } from '../lib/agendaWorkspace';

const ICONE = <svg aria-hidden="true" width="12" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="2" stroke="currentColor"/><path d="M6 6h4M6 9h4" stroke="currentColor"/></svg>;

export function AtividadeAgenda({ item, abrir, style, gestos, onConcluir, mostrarHorario = false }) {
  const check = useRef(null);
  const concluindoRef = useRef(false);
  const [concluindo, setConcluindo] = useState(false);
  const itens = item.itens?.length ? item.itens : [item];
  const concluidas = itens.filter(i => i.resolvido).length;
  const completa = concluidas === itens.length;
  const parcial = concluidas > 0 && !completa;
  const agrupada = item.tipo === 'obrigacao' || itens.length > 1;
  const editavel = !concluindo && gestos?.habilitada(item);
  const podeConcluir = !agrupada && item.tipo === 'tarefa' && !item.conclusaoAutomatica && onConcluir;
  const mostrarConclusao = agrupada || podeConcluir || completa;
  const temHorario = mostrarHorario && item.horaInicio && (style?.height == null || style.height >= 44);
  const progresso = `${concluidas} de ${itens.length} concluídas`;
  useEffect(() => { if (check.current) check.current.indeterminate = parcial; }, [parcial]);
  async function alterarConclusao() {
    if (agrupada) { abrir(item); return; }
    if (concluindoRef.current || item.salvando || !podeConcluir) return;
    concluindoRef.current = true; setConcluindo(true);
    try { await onConcluir(item); }
    finally { concluindoRef.current = false; setConcluindo(false); }
  }
  const abrirDetalhe = e => { e.stopPropagation(); abrir(item); };
  return <div className={`agenda-event${temHorario ? ' has-time' : ''}${completa ? ' is-complete' : ''}${editavel ? ' is-draggable' : ''}${item.salvando ? ' is-saving' : ''}${style?.height < 36 ? ' is-short' : ''}${gestos?.previa?.item.id === item.id ? ' is-dragging' : ''}`}
    style={{ '--event-color': corAtividade(item), ...style }}
    onPointerDown={editavel ? e => gestos.iniciar(e,item) : undefined}
    onPointerMove={gestos?.mover} onPointerUp={gestos?.terminar} onPointerCancel={gestos?.cancelar} onLostPointerCapture={gestos?.cancelar}
    aria-busy={item.salvando || concluindo || undefined}>
    {mostrarConclusao && <input ref={check} className="agenda-event-check" type="checkbox" checked={completa} aria-checked={parcial ? 'mixed' : completa}
      aria-label={agrupada ? `${progresso} em ${item.titulo}. Abrir detalhes` : `${completa ? 'Reabrir' : 'Concluir'} ${item.titulo}`}
      title={agrupada ? progresso : completa ? 'Reabrir tarefa' : 'Concluir tarefa'} disabled={Boolean(item.salvando) || concluindo || (!agrupada && !podeConcluir)}
      onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()} onChange={alterarConclusao} />}
    <button type="button" className="agenda-event-open" aria-label={item.titulo} onClick={abrirDetalhe}
      onKeyDown={editavel ? e => gestos.teclado(e,item) : undefined}
      aria-keyshortcuts={editavel ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+Shift+ArrowUp Alt+Shift+ArrowDown' : undefined}
      title={`${item.titulo} · ${dataBR(item.dataInicio)}${item.dataFim !== item.dataInicio ? ` a ${dataBR(item.dataFim)}` : ''}${item.horaInicio ? ` · ${horarioAtividade(item)}` : ''}${itens.length > 1 ? ` · ${progresso}` : ''}`}>
      <span className="agenda-event-title">{item.tipo === 'obrigacao' && ICONE}{item.titulo}{itens.length === 1 && item.empresa ? ` · ${item.empresa}` : ''}</span>
      {!temHorario && itens.length > 1 && <small className="agenda-event-progress" aria-label={progresso}>{concluidas}/{itens.length}</small>}
      {temHorario && <span className="agenda-event-meta"><small className="agenda-event-time">{horarioAtividade(item)}</small>{itens.length > 1 && <small className="agenda-event-progress" aria-label={progresso}>{concluidas}/{itens.length}</small>}</span>}
    </button>
    {editavel && item.horaInicio && <><span className="agenda-resize agenda-resize-start" data-agenda-resize="inicio" aria-hidden="true"/><span className="agenda-resize agenda-resize-end" data-agenda-resize="fim" aria-hidden="true"/></>}
    {editavel && <span className="agenda-move-handle" data-agenda-move-handle="" aria-hidden="true"/>}
  </div>;
}
