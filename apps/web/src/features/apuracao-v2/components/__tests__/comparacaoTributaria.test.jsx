import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComparacaoTributaria } from '../ComparacaoTributaria';

const base = { competencia:'2026-09', rbt12:293653.78, receitaMensal:23076.26, origem:'EXTRATO_PGDAS', atividades:[{anexoImplicito:'III',sujeitoFatorR:true}] };
test('mostra meta, falta e compara os cinco anexos com o Presumido', () => {
  render(<ComparacaoTributaria {...base} folha12m={60000}/>);
  expect(screen.getByText(/82\.223,06/)).toBeInTheDocument();
  expect(screen.getByText(/22\.223,06/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Comparar anexos I a V e Lucro Presumido'));
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
  expect(screen.getByText('Informe a folha elegível')).toBeInTheDocument();
  expect(screen.getByText(/não altera o anexo das atividades atuais/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Folha elegível dos 12 meses anteriores (R$)'), {target:{value:'0'}});
  expect(screen.queryByText('Informe a folha elegível')).not.toBeInTheDocument();
});
test('limitações de folha, ISS e RBT12 parcial ficam explícitas e ISS inválido bloqueia', () => {
  render(<ComparacaoTributaria {...base} origem="PARCIAL_LOCAL"/>);
  fireEvent.click(screen.getByText('Comparar anexos I a V e Lucro Presumido'));
  expect(screen.getByText(/RBT12 parcial/)).toBeInTheDocument();
  expect(screen.getAllByText(/total está subestimado/).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('ISS do cenário (%)'), {target:{value:'10'}});
  expect(screen.getByRole('alert')).toHaveTextContent('entre 2% e 5%');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
test('exportações não recebem simulação de mercado interno', () => {
  render(<ComparacaoTributaria {...base} receitaExterna={1000}/>);
  fireEvent.click(screen.getByText('Comparar anexos I a V e Lucro Presumido'));
  expect(screen.getByText(/exportação exige segregação/)).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
