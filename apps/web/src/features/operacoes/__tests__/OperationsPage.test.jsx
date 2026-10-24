import { fireEvent, render, screen, within } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';
jest.mock('../OperationsDailyCalendar', () => ({ OperationsDailyCalendar: () => <div>Calendário preservado</div> }));
jest.mock('../OperationsAlerts', () => ({ OperationsAlerts: () => null }));
jest.mock('../OperationsRoutineCompanies', () => ({ OperationsRoutineCompanies: () => null }));
const companies = [{ companyId: 'a', razao: 'Alfa', guideCompliance: { das: { required: true, state: 'gerada', paymentStatus: 'PAID' } }, fluxoCarteira: { competencia: '2026-10', status: { chave: 'obrigacoes' }, apuracao: { apurada: true }, contabilizacao: {} } }];
it('gráfico abre exatamente uma obrigação paga com eixos separados e competência', () => {
  render(<OperationsPage companies={companies} competencia="2026-10" />);
  fireEvent.click(screen.getByRole('button', { name: 'Paga 1' }));
  const modal = within(screen.getByRole('dialog'));
  expect(modal.getByText(/Documento: Disponível · Envio: Pendente · Pagamento: Confirmado/)).toBeInTheDocument();
  expect(modal.getByRole('link', { name: 'Abrir empresa' })).toHaveAttribute('href', '/companies/a/guides?competencia=2026-10');
});
it('Obrigações conserva o destino e período; trocar competência fecha o gráfico antigo', () => {
  const view = render(<OperationsPage companies={companies} competencia="2026-10" />);
  fireEvent.click(screen.getByRole('button', { name: 'Obrigações 1' }));
  expect(within(screen.getByRole('dialog')).getByRole('link')).toHaveAttribute('href', '/companies/a/obrigacoes?competencia=2026-10');
  view.rerender(<OperationsPage companies={companies} competencia="2026-09" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('loading e erro não mostram distribuição antiga como atual; vazio é separado', () => {
  const view = render(<OperationsPage companies={companies} competencia="2026-10" loading />);
  expect(screen.getByRole('button', { name: 'Paga —' })).toBeDisabled();
  view.rerender(<OperationsPage companies={[]} competencia="2026-10" />);
  expect(screen.getByRole('button', { name: 'Paga 0' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Paga 0' }));
  expect(within(screen.getByRole('dialog')).getByText('Nenhum item neste grupo.')).toBeInTheDocument();
  view.rerender(<OperationsPage companies={companies} competencia="2026-10" error="Falha de leitura" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Paga —' })).toBeDisabled();
});
