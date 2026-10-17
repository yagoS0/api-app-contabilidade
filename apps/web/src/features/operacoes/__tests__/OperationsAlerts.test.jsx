import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperationsAlerts } from '../OperationsAlerts';
test('avisa sobre setembro independentemente do mês atual e permite revisar sem consulta fiscal', async () => {
  const api = { getOperationAlerts: jest.fn(async () => ({ total: 1, items: [{ id: 'p', portalClientId: 'a', competencia: '2026-09', portalClient: { razao: 'CDA' }, observacoes: 'Nota emitida em 03/10 para setembro' }] })) };
  render(<OperationsAlerts api={api} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('1'));
  fireEvent.click(screen.getByRole('button', { name: /Notas para revisão/ }));
  expect(screen.getByRole('link', { name: 'Revisar competência 2026-09' })).toHaveAttribute('href', '/companies/a/auditoria?competencia=2026-09');
  expect(api.getOperationAlerts).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', {name:'Abrir apuração'})).toHaveAttribute('href','/companies/a/cadastro-fiscal?competencia=2026-09');
  api.getOperationAlerts.mockResolvedValue({ total: 0, items: [] });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('0'));
});

test('resposta antiga não substitui a leitura mais recente e remover API limpa contagem', async () => {
  let resolveOld;
  const api = { getOperationAlerts: jest.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue({ total: 0, items: [] }) };
  const { rerender } = render(<OperationsAlerts api={api} />);
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('0'));
  await act(async () => resolveOld({ total: 12, items: [] }));
  expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('0');
  rerender(<OperationsAlerts api={{}} />);
  expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('Indisponível');
  expect(screen.getByRole('button', { name: /Notas para revisão/ })).not.toHaveTextContent('0');
});

test('resposta inválida não é apresentada como contagem confiável', async () => {
  render(<OperationsAlerts api={{ getOperationAlerts: async () => ({ total: -1, items: [] }) }} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('Leitura indisponível'));
});
test('falha de atualização não aparece como ausência de pendência', async () => {
  render(<OperationsAlerts api={{ getOperationAlerts: async () => { throw Error('offline'); } }} />);
  fireEvent.click(screen.getByRole('button', { name: /Notas para revisão/ }));
  await screen.findByRole('alert'); expect(screen.queryByText(/Nenhum aviso/)).not.toBeInTheDocument();
});
