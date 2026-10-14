// Integração do estudo IBS/CBS compacto solicitado em 14/10/2026.
// Fórmulas e fundamentos continuam cobertos em lib/ibsCbsNoSimples.test.js.
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PlanejamentoPage } from '../renderPlanejamentoPage.jsx';
function montar(receita = '10000000') {
  render(<PlanejamentoPage api={{}} />);
  fireEvent.click(screen.getByLabelText('Incluir IBS e CBS no estudo'));
  if (receita) fireEvent.change(screen.getByLabelText('Receita anual (R$)'), { target: { value: receita } });
}
const bloco = () => screen.getByRole('region', { name: 'IBS e CBS no Simples Nacional' });
const futuro = () => fireEvent.click(within(bloco()).getByRole('button', { name: '2027–2028' }));
it('2026 mostra zero para Simples sem campo de estimativa ou texto introdutório', () => {
  montar(); expect(bloco()).toHaveTextContent('IBS/CBS no Simples em 2026: R$ 0,00');
  expect(within(bloco()).queryByLabelText(/Alíquota da CBS/)).toBeNull();
  expect(screen.queryByText('O que comparar aqui:')).toBeNull();
});
it('sem receita mantém o estudo indisponível', () => {
  montar(''); expect(screen.queryByRole('region', { name: 'IBS e CBS no Simples Nacional' })).toBeNull();
});
it('distingue DAS, imposto de consumo e crédito do comprador, sem inventar CBS ausente', () => {
  montar(); futuro();
  expect(bloco()).toHaveTextContent('DAS anual: R$ 6.000,00');
  expect(bloco()).toHaveTextContent('Débito anual de IBS/CBS: —');
  expect(bloco()).toHaveTextContent('IBS: 0,05% estadual + 0,05% municipal');
  expect(bloco()).toHaveTextContent('Total incompleto');
  expect(bloco().textContent.indexOf('DAS anual')).toBeLessThan(bloco().textContent.indexOf('Crédito do comprador'));
});
it('CBS digitada alimenta o híbrido e diferença de créditos', () => {
  montar(); futuro(); fireEvent.change(within(bloco()).getByLabelText(/Alíquota da CBS/), { target: { value: '8,8' } });
  expect(bloco()).toHaveTextContent('Débito anual de IBS/CBS: R$ 8.900,00');
  expect(bloco()).toHaveTextContent('Crédito do comprador: 8,90%');
  expect(bloco()).toHaveTextContent('Diferença de crédito ao comprador no regime regular:');
  expect(bloco()).toHaveTextContent('Parcela retirada do DAS:');
});
it('na sexta faixa não apresenta o DAS atual como calculado para 2027', () => {
  montar('400000000'); futuro();
  expect(bloco()).toHaveTextContent('DAS anual: Não calculado nesta faixa para 2027–2028');
});
it('percentual inválido continua exibindo erro', () => {
  montar(); futuro();fireEvent.change(within(bloco()).getByLabelText(/Alíquota da CBS/), { target: { value: '101' } });
  expect(within(bloco()).getByRole('alert')).toBeInTheDocument();
});
