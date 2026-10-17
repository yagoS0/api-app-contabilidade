import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const mockLer = jest.fn();
const mockReabrir = jest.fn();
jest.mock('../../../../../api/client', () => ({ createApiClient: () => ({
  getAvisosContabeis: async () => ({ ok: true, total: 0, correcoes: [], pagamentos: [], historico: [] }),
  getFechamentoContabil: (...args) => mockLer(...args),
  reabrirFechamentoContabil: (...args) => mockReabrir(...args),
}) }));
jest.mock('../GuiasPendentesContabilizacao', () => ({ GuiasPendentesContabilizacao: () => null }));
const { FechamentoCadeado } = require('../renderAccountingEntriesTab');
const montar = (props = {}) => render(<FechamentoCadeado myRole="ACCOUNTANT" companyId="A" competencia="2026-09" entries={[]} {...props}/>);
beforeEach(() => { jest.clearAllMocks(); mockReabrir.mockReset(); mockLer.mockResolvedValue({ fechado: true, versao: "v1" }); });

test.each([undefined, { ok: false, message: 'Recusa de gravação' }, { ok: true, fechado: true }])('reabertura não confirmada não libera lançamentos: %p', async resposta => {
  mockReabrir.mockResolvedValue(resposta);
  const onState = jest.fn(), onLoad = jest.fn();
  montar({ onState, onLoad });
  await screen.findByText('✓ Mês fechado');
  fireEvent.click(screen.getByRole('button', { name: /Corrigir mês fechado/ }));
  const modal = await screen.findByRole('dialog', { name: 'Corrigir mês fechado' });
  fireEvent.change(within(modal).getByLabelText('Motivo da correção'), { target: { value: 'Corrigir conta informada' } });
  fireEvent.click(within(modal).getByRole('button', { name: 'Corrigir mês fechado' }));
  await screen.findAllByRole('alert');
  expect(screen.getByText('✓ Mês fechado')).toBeInTheDocument();
  expect(onState).not.toHaveBeenCalledWith(false);
  expect(onLoad).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar fechamento' }));
  await waitFor(() => expect(mockLer).toHaveBeenCalledTimes(2));
  expect(mockReabrir).toHaveBeenCalledTimes(1);
});

test('reabertura persistida atualiza o domínio contábil e solicita recarga', async () => {
  mockReabrir.mockResolvedValue({ ok: true, fechado: false, correcao: { id: "cor1" } });
  const onState = jest.fn(), onLoad = jest.fn();
  montar({ onState, onLoad });
  await screen.findByText('✓ Mês fechado');
  fireEvent.click(screen.getByRole('button', { name: /Corrigir mês fechado/ }));
  fireEvent.change(within(await screen.findByRole('dialog')).getByLabelText('Motivo da correção'), { target: { value: 'Corrigir conta informada' } });
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Corrigir mês fechado' }));
  await waitFor(() => expect(onState).toHaveBeenCalledWith(false));
  expect(onLoad).toHaveBeenCalledTimes(1);
});

test('falha de leitura não vira fechamento aberto conhecido', async () => {
  mockLer.mockResolvedValue({ ok: false, message: 'Leitura indisponível' });
  montar();
  expect(await screen.findByRole('alert')).toHaveTextContent('Leitura indisponível');
  expect(mockReabrir).not.toHaveBeenCalled();
});

const entriesEstaveis = [];
const contexto = (empresa, props = {}) => <FechamentoCadeado myRole="ACCOUNTANT" companyId={empresa} competencia="2026-09" entries={entriesEstaveis} {...props}/>;
async function solicitarReabertura() {
  await waitFor(() => expect(screen.getByRole('button', { name: /Corrigir mês fechado/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Corrigir mês fechado/ }));
}
async function confirmarReabertura() {
  await solicitarReabertura();
  fireEvent.change(within(await screen.findByRole('dialog')).getByLabelText('Motivo da correção'), { target: { value: 'Corrigir conta informada' } });
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Corrigir mês fechado' }));
  await act(async () => {});
}
test('confirmação antiga não escreve após A → B → A', async () => {
  const view = render(contexto('A'));
  await solicitarReabertura();
  const confirmarAntigo = within(screen.getByRole('dialog')).getByRole('button', { name: 'Corrigir mês fechado' });
  view.rerender(contexto('B'));
  view.rerender(contexto('A'));
  fireEvent.click(confirmarAntigo);
  await act(async () => {});
  expect(mockReabrir).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  mockReabrir.mockResolvedValue({ ok: true, fechado: false, correcao: { id: "cor1" } });
  await confirmarReabertura();
  expect(mockReabrir).toHaveBeenCalledTimes(1);
});
test.each(['sucesso', 'erro'])('mutação antiga %s não altera callbacks nem busy de A → B → A', async modo => {
  let resolver, rejeitar, resolverAtual;
  mockReabrir.mockImplementationOnce(() => new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolverAtual = resolve; }));
  const onState = jest.fn(), onLoad = jest.fn();
  const props = { onState, onLoad };
  const view = render(contexto('A', props));
  await confirmarReabertura();
  view.rerender(contexto('B', props));
  view.rerender(contexto('A', props));
  await confirmarReabertura();
  onState.mockClear();
  await act(async () => modo === 'erro' ? rejeitar(Error('erro antigo')) : resolver({ ok: true, fechado: false, correcao: { id: "cor1" } }));
  expect(onState).not.toHaveBeenCalled();
  expect(onLoad).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Salvando…/ })).toBeDisabled();
  await act(async () => resolverAtual({ ok: true, fechado: false, correcao: { id: "cor1" } }));
  expect(onLoad).toHaveBeenCalledTimes(1);
});
test('mutação concluída após desmontagem não chama consumidores', async () => {
  let resolver;
  mockReabrir.mockImplementationOnce(() => new Promise(resolve => { resolver = resolve; }));
  const onState = jest.fn(), onLoad = jest.fn();
  const view = render(contexto('A', { onState, onLoad }));
  await confirmarReabertura();
  view.unmount(); onState.mockClear();
  await act(async () => resolver({ ok: true, fechado: false, correcao: { id: "cor1" } }));
  expect(onState).not.toHaveBeenCalled(); expect(onLoad).not.toHaveBeenCalled();
});

test('mutação de competência anterior não altera o fechamento atual', async () => {
  let rejeitar;
  mockReabrir.mockImplementationOnce(() => new Promise((resolve, reject) => { rejeitar = reject; }));
  const onState = jest.fn(), onLoad = jest.fn();
  const view = render(contexto('A', { onState, onLoad }));
  await confirmarReabertura();
  view.rerender(contexto('A', { competencia: '2026-10', onState, onLoad }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Corrigir mês fechado/ })).toBeEnabled());
  onState.mockClear();
  await act(async () => rejeitar(Error('falha do mês anterior')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onState).not.toHaveBeenCalled(); expect(onLoad).not.toHaveBeenCalled();
});
