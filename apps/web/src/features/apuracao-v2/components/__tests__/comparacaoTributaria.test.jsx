import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComparacaoTributaria } from '../ComparacaoTributaria';

const abrirComparacao = () => {};

const base = { competencia:'2026-09', rbt12:293653.78, receitaMensal:23076.26, origem:'EXTRATO_PGDAS', atividades:[{anexoImplicito:'III',sujeitoFatorR:true}] };
test('mostra meta, falta e compara os cinco anexos com o Presumido', () => {
  render(<ComparacaoTributaria {...base} folha12m={60000}/>);
  abrirComparacao();
  expect(screen.getByText(/82\.223,06/)).toBeInTheDocument();
  expect(screen.getByText(/22\.223,06/)).toBeInTheDocument();
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(7);
  const iii = within(table).getAllByRole('row').find(r => r.textContent.includes('Anexo III'));
  expect(iii).toHaveTextContent('1.849,00');
  expect(iii).toHaveTextContent('8,0126%');
  fireEvent.change(screen.getByLabelText('Folha elegível dos 12 meses anteriores (R$)'), {target:{value:'82223.06'}});
  expect(screen.getByText('Limite de 28% atingido')).toBeInTheDocument();
});
test('folha ausente não vira zero; atividade sem Fator R mantém explicação', () => {
  render(<ComparacaoTributaria {...base} atividades={[{anexoImplicito:'III'}]}/>);
  abrirComparacao();
  expect(screen.getByText('Informe a folha elegível')).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByText(/não altera o anexo das atividades atuais/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Folha elegível dos 12 meses anteriores (R$)'), {target:{value:'0'}});
  expect(screen.queryByText('Informe a folha elegível')).not.toBeInTheDocument();
});
test('limitações de folha, ISS e RBT12 parcial ficam explícitas e ISS inválido bloqueia', () => {
  render(<ComparacaoTributaria {...base} origem="PARCIAL_LOCAL"/>);
  abrirComparacao();
  expect(screen.getByText(/RBT12 parcial/)).toBeVisible();
  expect(screen.getAllByText(/total está subestimado/).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('ISS do cenário (%)'), {target:{value:'10'}});
  expect(screen.getByRole('alert')).toHaveTextContent('entre 2% e 5%');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
test('exportações não recebem simulação de mercado interno', () => {
  render(<ComparacaoTributaria {...base} receitaExterna={1000}/>);
  abrirComparacao();
  expect(screen.getByText(/exportação exige segregação/)).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('Fator R e comparativo ficam visíveis, com progresso e planejamento híbrido sem valores inventados', () => {
  render(<ComparacaoTributaria {...base} folha12m={60000}/>);
  expect(screen.getByLabelText('Folha elegível dos 12 meses anteriores (R$)')).toBeVisible();
  expect(screen.getByRole('table')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '28');
  expect(Number(screen.getByRole('progressbar').value)).toBeCloseTo(20.432, 2);
  expect(screen.getByText(/Simples híbrido/)).toBeVisible();
  expect(screen.getByText(/Sem estimativa disponível/)).toBeVisible();
});

test('Fator R informa RBT12 parcial antes de abrir a comparação dos anexos', () => {
  render(<ComparacaoTributaria {...base} origem="PARCIAL_LOCAL" folha12m={60000}/>);
  abrirComparacao();
  expect(screen.getByLabelText('Folha elegível dos 12 meses anteriores (R$)')).toBeVisible();
  expect(screen.getByRole('table')).toBeVisible();
  expect(screen.getAllByRole('status').some(aviso => /RBT12 parcial/.test(aviso.textContent))).toBe(true);
  expect(screen.getByText(/82\.223,06/)).toBeVisible();
});

 test('meta de 28% preserva centavos exatos para RBT12 de 300 mil', () => {
  render(<ComparacaoTributaria {...base} rbt12={300000} folha12m={84000}/>);
  expect(screen.getByText('R$ 84.000,00')).toBeVisible();
  expect(screen.getByText('Limite de 28% atingido')).toBeVisible();
 });
