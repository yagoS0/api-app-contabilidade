import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsDailyCalendar } from '../OperationsDailyCalendar';
import { criarMockTarefasCalendario } from '../../../api/mock/tarefasCalendarioMock';

const empresas = [{ companyId: 'a', razaoSocial: 'Aurora' }];
beforeAll(() => {
  if (!global.crypto.randomUUID) global.crypto.randomUUID = () => `t-${Math.random().toString(36).slice(2)}`;
});

test('usa a agenda real no dia e navega sem consultar serviços fiscais', async () => {
  const api = criarMockTarefasCalendario(empresas);
  await api.criarTarefaCalendario({ titulo: 'Revisar documentos', empresasIds: ['a'], config: { dataInicio: '2026-10-15', dataFim: '2026-10-15', horarioModo: 'FIXO', horaInicio: '09:00' } });
  await api.criarTarefaCalendario({ titulo: 'Conferir amanhã', empresasIds: ['a'], config: { dataInicio: '2026-10-16', dataFim: '2026-10-16' } });
  jest.spyOn(api, 'listarTarefasCalendario');
  api.listObrigacoes = jest.fn();
  api.executeCompanyOperation = jest.fn();
  render(<OperationsDailyCalendar api={api} empresas={empresas} initialDate="2026-10-15" />);
  expect(await screen.findByRole('button', { name: 'Revisar documentos' })).toBeInTheDocument();
  expect(api.listarTarefasCalendario).toHaveBeenCalledWith({ inicio: '2026-10-15', fim: '2026-10-15', companyId: null });
  expect(screen.queryByLabelText('Visualização')).not.toBeInTheDocument();
  expect(screen.queryByText('Tarefas anteriores')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Conferir amanhã' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Revisar documentos' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Aurora');
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Próximo período' }));
  expect(await screen.findByRole('button', { name: 'Conferir amanhã' })).toBeInTheDocument();
  expect(api.listarTarefasCalendario).toHaveBeenLastCalledWith({ inicio: '2026-10-16', fim: '2026-10-16', companyId: null });
  expect(api.listObrigacoes).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('erro de leitura permanece visível e pode ser tentado novamente', async () => {
  const api = { listarTarefasCalendario: jest.fn().mockRejectedValueOnce(new Error('Não foi possível carregar as tarefas.')).mockResolvedValue({ ok: true, itens: [] }) };
  render(<OperationsDailyCalendar api={api} empresas={empresas} initialDate="2026-10-15" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as tarefas.');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(api.listarTarefasCalendario).toHaveBeenCalledTimes(2);
});
