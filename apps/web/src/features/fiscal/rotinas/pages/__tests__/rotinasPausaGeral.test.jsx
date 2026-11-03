import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PausaCicloFiscal } from '../renderRotinasPage';
const base = { paused: false, version: 0, legacy: true };
test('pausa e retomada são explícitas, versionadas e não salvam agenda', async () => {
  const api = { getPausaCicloFiscal: jest.fn(async () => ({ ok: true, policy: base })), savePausaCicloFiscal: jest.fn(async input => ({ ok: true, policy: { ...input, version: input.version + 1, actor: { name: 'Teste' }, changedAt: '2026-11-01T10:00:00Z' } })), saveRotinas: jest.fn() };
  render(<PausaCicloFiscal api={api} />);
  await screen.findByText(/Sem pausa geral/);
  fireEvent.change(screen.getByLabelText('Motivo da pausa'), { target: { value: 'Manutenção' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar pausa geral' }));
  await screen.findByText('Pausa geral ativa');
  expect(api.savePausaCicloFiscal).toHaveBeenCalledWith({ paused: true, version: 0, reason: 'Manutenção' });
  fireEvent.change(screen.getByLabelText('Motivo da retomada'), { target: { value: 'Conferido' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar retomada' }));
  await screen.findByText(/Sem pausa geral/);
  expect(api.saveRotinas).not.toHaveBeenCalled();
});
test('resposta vazia não anuncia sucesso e exige releitura', async () => {
  const api = { getPausaCicloFiscal: jest.fn(async () => ({ ok: true, policy: base })), savePausaCicloFiscal: jest.fn(async () => null) };
  render(<PausaCicloFiscal api={api} />); await screen.findByText(/Sem pausa geral/);
  fireEvent.change(screen.getByLabelText('Motivo da pausa'), { target: { value: 'Pausa' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar pausa geral' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Confirmar pausa geral' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar estado' }));
  await waitFor(() => expect(api.getPausaCicloFiscal).toHaveBeenCalledTimes(2));
});

test.each([false,true])('salvar pausa geral foca desfecho; falha=%s',async failure=>{
 const api={getPausaCicloFiscal:jest.fn(async()=>({ok:true,policy:base})),savePausaCicloFiscal:jest.fn(async input=>{
  if(failure)throw Object.assign(new Error('Conflito geral'),{status:409});
  return{ok:true,policy:{...input,version:1}};
 })};
 render(<PausaCicloFiscal api={api}/>);await screen.findByText(/Sem pausa geral/);
 fireEvent.change(screen.getByLabelText('Motivo da pausa'),{target:{value:'Conferir'}});
 const save=screen.getByRole('button',{name:'Confirmar pausa geral'});save.focus();fireEvent.click(save);
 await waitFor(()=>expect(screen.getByRole(failure?'alert':'status')).toHaveFocus());
 expect(api.savePausaCicloFiscal).toHaveBeenCalledTimes(1);
 if(failure){expect(screen.getByLabelText('Motivo da pausa')).toHaveValue('Conferir');expect(screen.getByRole('button',{name:'Confirmar pausa geral'})).toBeDisabled();}
});
test('pausa geral não toma foco escolhido durante gravação',async()=>{
 let finish;const api={getPausaCicloFiscal:jest.fn(async()=>({ok:true,policy:base})),savePausaCicloFiscal:jest.fn(()=>new Promise(resolve=>{finish=resolve;}))};
 render(<PausaCicloFiscal api={api}/>);await screen.findByText(/Sem pausa geral/);
 fireEvent.change(screen.getByLabelText('Motivo da pausa'),{target:{value:'Conferir'}});
 const save=screen.getByRole('button',{name:'Confirmar pausa geral'});save.focus();fireEvent.click(save);
 const summary=screen.getByText('Alcance da pausa');summary.focus();
 await act(async()=>finish({ok:true,policy:{paused:true,version:1}}));
 expect(summary).toHaveFocus();expect(screen.getByRole('status')).toHaveTextContent('Pausa geral ativa');
});