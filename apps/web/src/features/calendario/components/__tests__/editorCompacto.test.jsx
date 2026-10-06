import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModalAtividade } from '../ModalAtividade';

const inicial = {dataInicio:'2026-10-08',dataFim:'2026-10-08',horaInicio:'08:00',horaFim:'09:00'};
test('criação rápida salva o bloco e o seletor muda data e duração sem perder o título', async () => {
  const api = {salvarTarefaAgenda:jest.fn(async () => ({ok:true}))};
  render(<ModalAtividade inicial={inicial} api={api} empresas={[]} onFechar={()=>{}} onSalvo={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Conferir documentos'}});
  fireEvent.click(screen.getByText(/8 de out/));
  fireEvent.click(screen.getByRole('button',{name:'Selecionar 09/10/2026'}));
  expect(screen.getByLabelText('Até')).toHaveValue('2026-10-09');
  fireEvent.click(screen.getByRole('button',{name:'2 h'}));
  expect(screen.getByLabelText('Horário final')).toHaveValue('10:00');
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.salvarTarefaAgenda).toHaveBeenCalledWith(expect.objectContaining({titulo:'Conferir documentos',config:expect.objectContaining({dataInicio:'2026-10-09',dataFim:'2026-10-09',horaInicio:'08:00',horaFim:'10:00'})})));
});

test('calendário navega dezembro para janeiro e conserva a seleção até escolher um dia', () => {
  render(<ModalAtividade inicial={{...inicial,dataInicio:'2026-12-31',dataFim:'2026-12-31'}} api={{}} empresas={[]} onFechar={()=>{}} onSalvo={()=>{}}/>);
  fireEvent.click(screen.getByText(/31 de dez/));
  fireEvent.click(screen.getByRole('button',{name:'Próximo mês na seleção'}));
  expect(screen.getByText('janeiro de 2027')).toBeInTheDocument();
  expect(screen.getByLabelText('De')).toHaveValue('2026-12-31');
  fireEvent.click(screen.getByRole('button',{name:'Selecionar 01/01/2027'}));
  expect(screen.getByLabelText('De')).toHaveValue('2027-01-01');
  expect(screen.getByLabelText('Até')).toHaveValue('2027-01-01');
});

test('seleciona início e fim no mesmo calendário e salva intervalo com horários',async()=>{
  const api={salvarTarefaAgenda:jest.fn(async()=>({ok:true}))};
  render(<ModalAtividade inicial={inicial} api={api} empresas={[]} onFechar={()=>{}} onSalvo={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Conferência mensal'}});
  fireEvent.click(screen.getByText(/8 de out/));
  fireEvent.click(screen.getByRole('button',{name:'Selecionar 10/10/2026'}));
  expect(screen.getByText('Agora selecione o fim do período')).toBeInTheDocument();
  fireEvent.mouseEnter(screen.getByRole('button',{name:'Selecionar 15/10/2026'}));
  expect(screen.getByRole('button',{name:'Selecionar 12/10/2026'})).toHaveClass('is-in-range');
  fireEvent.click(screen.getByRole('button',{name:'Selecionar 15/10/2026'}));
  expect(screen.getByLabelText('De')).toHaveValue('2026-10-10');
  expect(screen.getByLabelText('Até')).toHaveValue('2026-10-15');
  expect(screen.getByText(/10 de out.*15 de out/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.salvarTarefaAgenda).toHaveBeenCalledWith(expect.objectContaining({config:expect.objectContaining({dataInicio:'2026-10-10',dataFim:'2026-10-15',horaInicio:'08:00',horaFim:'09:00'})})));
});

test('seleção atravessa ano e permite mudar somente o fim pelo mesmo calendário',()=>{
  render(<ModalAtividade inicial={{...inicial,dataInicio:'2026-12-20',dataFim:'2026-12-20'}} api={{}} empresas={[]} onFechar={()=>{}} onSalvo={()=>{}}/>);
  fireEvent.click(screen.getByText(/20 de dez/));
  fireEvent.click(screen.getByRole('button',{name:'Selecionar 28/12/2026'}));
  fireEvent.click(screen.getByRole('button',{name:'Próximo mês na seleção'}));
  fireEvent.click(screen.getByRole('button',{name:'Selecionar 05/01/2027'}));
  expect(screen.getByLabelText('De')).toHaveValue('2026-12-28');
  expect(screen.getByLabelText('Até')).toHaveValue('2027-01-05');
  fireEvent.focus(screen.getByLabelText('Até'));
  fireEvent.click(screen.getByRole('button',{name:'Selecionar 08/01/2027'}));
  expect(screen.getByLabelText('De')).toHaveValue('2026-12-28');
  expect(screen.getByLabelText('Até')).toHaveValue('2027-01-08');
});

test('calendário aceita ordem inversa e período de um dia, inclusive sem datas iniciais',()=>{
  render(<ModalAtividade inicial={{dataInicio:'',dataFim:''}} api={{}} empresas={[]} onFechar={()=>{}} onSalvo={()=>{}}/>);
  fireEvent.click(screen.getByText(/Escolher prazo/));
  const botoes=screen.getAllByRole('button',{name:/Selecionar/});
  fireEvent.click(botoes[15]);fireEvent.click(botoes[10]);
  const inicio=screen.getByLabelText('De'),fim=screen.getByLabelText('Até');
  expect(inicio.value < fim.value).toBe(true);
  fireEvent.click(botoes[10]);fireEvent.click(botoes[10]);
  expect(inicio.value).toBe(fim.value);
});
