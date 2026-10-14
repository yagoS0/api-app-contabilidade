import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FerramentasNfse } from '../FerramentasNfse';

function apiBase() { return { listarRecorrenciasNfse: jest.fn(async () => ({ items: [], workerAtivo: false })), getVerificacaoNfse: jest.fn(async () => ({ ok: true, verificacao: null })), verificarNfseReforma: jest.fn(), emitirNfse: jest.fn() }; }
test('botões abrem modais; abrir conformidade apenas lê a conferência salva', async () => {
  const api = apiBase(); render(<FerramentasNfse api={api} companyId="a" competencia="2026-09" />);
  expect(document.querySelector('summary')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Notas recorrentes' }));
  expect(screen.getByRole('dialog', { name: 'Notas recorrentes' })).toBeInTheDocument();
  await screen.findByText(/Nenhuma nota recorrente/);
  fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
  fireEvent.click(screen.getByRole('button', { name: 'Verificar conformidade' }));
  await screen.findByText(/Nenhuma conferência registrada/);
  expect(api.getVerificacaoNfse).toHaveBeenCalledWith('a', '2026-09');
  expect(api.verificarNfseReforma).not.toHaveBeenCalled(); expect(api.emitirNfse).not.toHaveBeenCalled();
});
test('modal não fecha durante verificação e libera após erro explícito', async () => {
  const api = apiBase(); let rejeitar;
  api.verificarNfseReforma.mockImplementation(() => new Promise((_, reject) => { rejeitar = reject; }));
  render(<FerramentasNfse api={api} companyId="a" competencia="2026-09" />);
  fireEvent.click(screen.getByRole('button', { name: 'Verificar conformidade' }));
  await screen.findByText(/Nenhuma conferência registrada/);
  fireEvent.click(screen.getByRole('button', { name: 'Verificar notas armazenadas' }));
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeInTheDocument();
  await act(async () => rejeitar(new Error('Não foi possível conferir')));
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível conferir');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Concluir' })).toBeEnabled());
});

test('indicadores contam notas pendentes e sinalizam conferência desatualizada', async () => {
  const api = apiBase();
  api.listarRecorrenciasNfse.mockResolvedValue({ items: [{ ativa: true }, { ativa: false }] });
  api.getVerificacaoNfse.mockResolvedValue({ ok: true, desatualizada: true, verificacao: { itens: [{ status: 'ERRO' }, { status: 'REVISAO' }, { status: 'ALERTA' }, { status: 'SEM_ACHADOS' }] } });
  const { rerender } = render(<FerramentasNfse api={api} companyId="a" competencia="2026-09" />);
  await screen.findByLabelText('2 recorrências cadastradas');
  expect(await screen.findByLabelText('3 notas com apontamentos na conferência salva')).toBeInTheDocument();
  expect(screen.getByLabelText('Conferência desatualizada')).toBeInTheDocument();
  api.listarRecorrenciasNfse.mockRejectedValue(new Error('offline'));
  api.getVerificacaoNfse.mockResolvedValue({ ok: true, verificacao: null });
  rerender(<FerramentasNfse api={api} companyId="b" competencia="2026-10" />);
  await screen.findByLabelText(/Não foi possível carregar as recorrências/);
  expect(screen.queryByLabelText('3 notas com apontamentos na conferência salva')).not.toBeInTheDocument();
  expect(api.verificarNfseReforma).not.toHaveBeenCalled();
  expect(api.emitirNfse).not.toHaveBeenCalled();
});
