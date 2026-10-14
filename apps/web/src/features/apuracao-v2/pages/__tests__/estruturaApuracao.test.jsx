import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ApuracaoV2Tab } from '../renderApuracaoV2Tab';

let salvo;
jest.mock('../../../apuracao/components/FechamentoModal', () => ({FechamentoModal: ({onChanged}) => <button onClick={onChanged}>Salvar cálculo de teste</button>}));

it('reúne ações e indicadores no quadro inicial e relê DAS salvo após calcular', async () => {
  salvo = null;
  const api = {
    getFechamento: jest.fn(async () => ({dados:{rbt12:300000,faturamento:{interno:23076.26,externo:0},atividades:[{anexoImplicito:'III'}]}})),
    getApuracaoSnapshot: jest.fn(async () => ({snapshot:salvo})),
    getRelatorioFaturamento: jest.fn(async () => ({relatorio:null})),
  };
  render(<ApuracaoV2Tab api={api} panel={{pendencias:[]}} companyId="empresa" competencia="2026-09"/>);
  const calcular = await screen.findByRole('button', {name:'Calcular / Fechar'});
  await waitFor(() => expect(screen.getAllByText('R$ 23.076,26')[0]).toBeVisible());
  const quadro = screen.getByRole('region', {name:'Resumo e ações da competência'});
  expect(within(quadro).getByRole('button',{name:'Buscar extrato'})).toBeVisible();
  expect(calcular.parentElement).toBe(within(quadro).getByRole('button',{name:'Buscar extrato'}).parentElement);
  expect(screen.queryByText(/Como a carga efetiva/)).toBeNull();
  expect(screen.queryByText(/soma móvel dos últimos 12 meses/)).toBeNull();
  expect(within(quadro).getByText('Fat. interno')).toBeVisible();
  expect(within(quadro).getByText('DAS apurado')).toBeVisible();
  expect(screen.getByRole('button',{name:'Classificar'})).toBeVisible();
  expect(screen.getAllByRole('table')[0]).toBeVisible();
  fireEvent.click(calcular);
  salvo={estado:'calculada',dasSimuladoSerpro:1849};
  fireEvent.click(screen.getByRole('button',{name:'Salvar cálculo de teste'}));
  await waitFor(() => expect(within(quadro).getByText('DAS oficial simulado (SERPRO)')).toBeVisible());
  expect(within(quadro).getByText('R$ 1.849,00')).toBeVisible();
  expect(screen.queryByText('Extrato do Simples Nacional')).not.toBeInTheDocument();
});

it('identifica foto salva desatualizada sem calcular carga com a base nova', async () => {
 const api = {
  getFechamento:async()=>({dados:{faturamento:{interno:10000,externo:0},calculoSalvo:{dasValor:1849},calculoRecuperacaoMotivo:'Os dados fiscais mudaram; calcule novamente.'}}),
  getApuracaoSnapshot:async()=>({snapshot:{dasSimuladoSerpro:1849}}),
  getRelatorioFaturamento:async()=>({relatorio:null}),
 };
 render(<ApuracaoV2Tab api={api} panel={{pendencias:[]}} companyId="empresa" competencia="2026-09"/>);
 expect(await screen.findByText('DAS salvo · revisar base')).toBeVisible();
 expect(screen.getByText('Os dados fiscais mudaram; calcule novamente.')).toBeVisible();
 expect(screen.getByText('Carga efetiva calculada').parentElement).toHaveTextContent('—');
});

it('classificação alterada sinaliza DAS anterior mesmo sem envelope de cálculo salvo', async () => {
 const api = {
  getFechamento:async()=>({dados:{faturamento:{interno:10000,externo:0},calculoRecuperavel:null,calculoRecuperacaoMotivo:'Não foi possível comprovar a integridade do cálculo salvo.'}}),
  getApuracaoSnapshot:async()=>({snapshot:{estado:'calculada',idempotencyKey:'reclassificada:teste',dasSimuladoSerpro:1849}}),
  getRelatorioFaturamento:async()=>({relatorio:null}),
 };
 render(<ApuracaoV2Tab api={api} panel={{pendencias:[]}} companyId="empresa" competencia="2026-09"/>);
 expect(await screen.findByText('DAS salvo · revisar base')).toBeVisible();
 expect(screen.getByText(/A classificação foi alterada/)).toBeVisible();
 expect(screen.getByText('Carga efetiva calculada').parentElement).toHaveTextContent('—');
 expect(screen.getByText('R$ 1.849,00')).toBeVisible();
});
