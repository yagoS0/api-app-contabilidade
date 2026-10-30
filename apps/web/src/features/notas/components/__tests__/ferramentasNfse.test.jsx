import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FerramentasNfse } from '../FerramentasNfse';
function apiBase() { return { listarRecorrenciasNfse: jest.fn(async () => ({ items: [], workerAtivo: false })), getVerificacaoNfse: jest.fn(), verificarNfseReforma: jest.fn(), emitirNfse: jest.fn() }; }
test('recorrências abre modal sem entrada, painel ou leitura de conformidade', async () => {
  const api = apiBase(); render(<FerramentasNfse api={api} companyId="a" competencia="2026-09" />);
  const abrir = screen.getByRole('button', { name: 'Notas recorrentes' });
  abrir.focus(); fireEvent.click(abrir);
  expect(screen.getByRole('dialog', { name: 'Notas recorrentes' })).toBeInTheDocument();
  await screen.findByText(/Nenhuma nota recorrente/);
  fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
  await waitFor(() => expect(abrir).toHaveFocus());
  expect(screen.queryByText(/Verificar conformidade|Conformidade de NFS-e/)).not.toBeInTheDocument();
  expect(api.getVerificacaoNfse).not.toHaveBeenCalled();
  expect(api.verificarNfseReforma).not.toHaveBeenCalled(); expect(api.emitirNfse).not.toHaveBeenCalled();
});
test('recorrência ocupada impede fechamento e libera após erro explícito', async () => {
  const api = apiBase(); let rejeitar;
  api.listarRecorrenciasNfse.mockResolvedValue({ items: [{ id: 'r', ativa: true, modelo: { tomador: { nome: 'Teste' }, servico: { valorServicos: 100, descricao: 'Serviço' } }, execucoes: [] }] });
  api.alterarRecorrenciaNfse = jest.fn(() => new Promise((_, reject) => { rejeitar = reject; }));
  const confirmar = jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<FerramentasNfse api={api} companyId="a" competencia="2026-09" />);
  fireEvent.click(screen.getByRole('button', { name: 'Notas recorrentes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }));
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeInTheDocument();
  await act(async () => rejeitar(new Error('Não foi possível pausar')));
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível pausar');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Concluir' })).toBeEnabled());
  expect(api.alterarRecorrenciaNfse).toHaveBeenCalledWith('a', 'r', 'pausar', expect.objectContaining({ confirmada: true }));
  confirmar.mockRestore();
});
test('contador, falha e mudança de contexto conservam ausência de chamadas fiscais', async () => {
  const api = apiBase(); api.listarRecorrenciasNfse.mockResolvedValue({ items: [{ ativa: true }, { ativa: false }] });
  const { rerender } = render(<FerramentasNfse api={api} companyId="a" competencia="2026-09" />);
  await screen.findByLabelText('2 recorrências cadastradas');
  api.listarRecorrenciasNfse.mockRejectedValue(new Error('offline'));
  rerender(<FerramentasNfse api={api} companyId="b" competencia="2026-10" />);
  await screen.findByLabelText(/Não foi possível carregar as recorrências/);
  expect(api.listarRecorrenciasNfse).toHaveBeenLastCalledWith('b');
  expect(screen.queryByLabelText('2 recorrências cadastradas')).not.toBeInTheDocument();
  expect(api.getVerificacaoNfse).not.toHaveBeenCalled(); expect(api.verificarNfseReforma).not.toHaveBeenCalled(); expect(api.emitirNfse).not.toHaveBeenCalled();
});
