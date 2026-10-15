import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperationsAlerts } from '../OperationsAlerts';
test('avisa sobre setembro independentemente do mês atual e permite revisar sem consulta fiscal', async () => {
  const api = { getOperationAlerts: jest.fn(async () => ({ total: 1, items: [{ id: 'p', portalClientId: 'a', competencia: '2026-09', portalClient: { razao: 'CDA' }, observacoes: 'Nota emitida em 03/10 para setembro' }] })) };
  render(<OperationsAlerts api={api} />);
  await screen.findByRole('button', { name: 'Ver notas e revisar retificação' });
  fireEvent.click(screen.getByRole('button', { name: 'Ver notas e revisar retificação' }));
  expect(screen.getByRole('link', { name: 'Revisar competência 2026-09' })).toHaveAttribute('href', '/companies/a/auditoria?competencia=2026-09');
  expect(api.getOperationAlerts).toHaveBeenCalledTimes(1);
  api.getOperationAlerts.mockResolvedValue({ total: 0, items: [] });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Ver notas e revisar retificação' })).not.toBeInTheDocument());
});
test('falha de atualização não aparece como ausência de pendência', async () => {
  render(<OperationsAlerts api={{ getOperationAlerts: async () => { throw Error('offline'); } }} />);
  await screen.findByRole('alert'); expect(screen.queryByText(/Nenhum aviso/)).not.toBeInTheDocument();
});
