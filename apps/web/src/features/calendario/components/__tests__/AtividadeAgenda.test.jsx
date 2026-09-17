import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AtividadeAgenda } from '../AtividadeAgenda';
import { posicionarHorarios } from '../../lib/agendaWorkspace';

const tarefa = { id:'a', tarefaId:'a', tipo:'tarefa', titulo:'Conferir notas', dataInicio:'2026-09-17', dataFim:'2026-09-17', horaInicio:'09:00', horaFim:'10:00', resolvido:false };

test('checkbox conclui e reabre sem abrir edição nem iniciar um gesto', async () => {
  const abrir = jest.fn(), onConcluir = jest.fn(), iniciar = jest.fn();
  const props = { item:tarefa, abrir, onConcluir, gestos:{habilitada:()=>true,iniciar} };
  const { rerender } = render(<AtividadeAgenda {...props}/>);
  const checkbox = screen.getByRole('checkbox',{name:'Concluir Conferir notas'});
  fireEvent.pointerDown(checkbox); fireEvent.click(checkbox);
  expect(onConcluir).toHaveBeenCalledWith(tarefa);
  expect(abrir).not.toHaveBeenCalled(); expect(iniciar).not.toHaveBeenCalled();
  await waitFor(()=>expect(checkbox).toBeEnabled());
  rerender(<AtividadeAgenda {...props} item={{...tarefa,resolvido:true}}/>);
  expect(screen.getByRole('checkbox',{name:'Reabrir Conferir notas'})).toBeChecked();
  expect(screen.getByRole('button',{name:tarefa.titulo}).closest('.agenda-event')).toHaveClass('is-complete');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(onConcluir).toHaveBeenLastCalledWith(expect.objectContaining({resolvido:true}));
  await waitFor(()=>expect(screen.getByRole('checkbox')).toBeEnabled());
});

test('resposta lenta bloqueia cliques duplicados e libera checkbox depois de terminar', async () => {
  let terminar;
  const onConcluir=jest.fn(()=>new Promise(resolve=>{terminar=resolve;}));
  render(<AtividadeAgenda item={tarefa} abrir={jest.fn()} onConcluir={onConcluir}/>);
  const checkbox=screen.getByRole('checkbox');
  fireEvent.click(checkbox); fireEvent.click(checkbox);
  expect(onConcluir).toHaveBeenCalledTimes(1);
  expect(checkbox).toBeDisabled();
  expect(checkbox.closest('.agenda-event')).toHaveAttribute('aria-busy','true');
  await act(async()=>terminar());
  expect(checkbox).toBeEnabled();
  expect(checkbox.closest('.agenda-event')).not.toHaveAttribute('aria-busy');
});

test.each([[0,false,false],[1,false,true],[2,true,false]])('grupo com %s conclusões preserva acompanhamento por empresa', (quantidade, marcada, parcial) => {
  const abrir=jest.fn(), onConcluir=jest.fn();
  const item={...tarefa,tipo:'obrigacao',itens:[0,1].map(n=>({...tarefa,id:String(n),resolvido:n<quantidade}))};
  render(<AtividadeAgenda item={item} abrir={abrir} onConcluir={onConcluir}/>);
  const checkbox=screen.getByRole('checkbox');
  expect(checkbox.checked).toBe(marcada); expect(checkbox.indeterminate).toBe(parcial);
  fireEvent.click(checkbox);
  expect(abrir).toHaveBeenCalledWith(item); expect(onConcluir).not.toHaveBeenCalled();
  expect(screen.getByText(`${quantidade}/2`)).toBeInTheDocument();
});

test('botão mantém título completo, edição e movimentação por teclado', () => {
  const abrir=jest.fn(), teclado=jest.fn(), iniciar=jest.fn();
  render(<AtividadeAgenda item={tarefa} abrir={abrir} onConcluir={jest.fn()} gestos={{habilitada:()=>true,teclado,iniciar}}/>);
  const button=screen.getByRole('button',{name:tarefa.titulo});
  expect(button.title).toContain('09:00–10:00');
  fireEvent.pointerDown(button); expect(iniciar).toHaveBeenCalled();
  fireEvent.keyDown(button,{key:'ArrowDown',altKey:true}); expect(teclado).toHaveBeenCalled();
  fireEvent.click(button); expect(abrir).toHaveBeenCalledWith(tarefa);
  expect(button.querySelector('input, button')).toBeNull();
});

test('eventos muito curtos não se cobrem por causa da altura visual mínima', () => {
  const positions=posicionarHorarios([{...tarefa,horaFim:'09:05'},{...tarefa,id:'b',horaInicio:'09:10',horaFim:'09:15'},{...tarefa,id:'c',horaInicio:'10:00',horaFim:'10:05'}]);
  expect(positions.map(p=>[p.coluna,p.colunas])).toEqual([[0,2],[1,2],[0,1]]);
});

test('evento aproveita colunas livres quando os vizinhos terminam', () => {
  const positions=posicionarHorarios([
    {...tarefa,id:'a',horaInicio:'09:00',horaFim:'12:00'},
    {...tarefa,id:'b',horaInicio:'09:00',horaFim:'10:00'},
    {...tarefa,id:'c',horaInicio:'09:00',horaFim:'10:00'},
    {...tarefa,id:'d',horaInicio:'10:00',horaFim:'11:00'},
  ]);
  expect(positions.find(p=>p.item.id==='d')).toMatchObject({coluna:1,colunas:3,extensao:2});
  expect(positions.find(p=>p.item.id==='a')).toMatchObject({coluna:0,colunas:3,extensao:1});
});
