import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ApuracaoV2Tab } from '../renderApuracaoV2Tab';

jest.mock('../../../apuracao/components/FechamentoModal', () => ({ FechamentoModal: () => <div>Editor de retificação</div> }));
const panel = { pendencias: [] };
const feedback = { notifySuccess: jest.fn(), notifyError: jest.fn() };
function cliente(reabrir) {
  return {
    getFechamento: jest.fn(async () => ({ dados: { estado: 'transmitida' } })),
    getApuracaoSnapshot: jest.fn(async () => ({ snapshot: null })),
    getRelatorioFaturamento: jest.fn(async () => ({ relatorio: null })),
    reabrirFechamento: reabrir,
  };
}
const tela = (api, competencia = '2026-09') => <ApuracaoV2Tab api={api} panel={panel} feedback={feedback} companyId="empresa" competencia={competencia} razao="Empresa teste" />;
beforeEach(() => jest.clearAllMocks());
async function confirmar() {
  fireEvent.click(await screen.findByRole('button', { name: 'Retificar' }));
  fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Conferir receita posterior' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir apuração' }));
}
it.each([undefined, jest.fn(async () => undefined), jest.fn(async () => ({ ok: true }))])('não inventa reabertura com contrato incompleto', async reabrir => {
  render(tela(cliente(reabrir)));
  await confirmar();
  await waitFor(() => expect(feedback.notifyError).toHaveBeenCalled());
  expect(feedback.notifySuccess).not.toHaveBeenCalled();
  expect(screen.queryByText('Editor de retificação')).not.toBeInTheDocument();
});
it('confirma persistência, impede repetição e relê o estado antes de editar', async () => {
  let resolver;
  const api = cliente(jest.fn(() => new Promise(resolve => { resolver = resolve; })));
  render(tela(api));
  await confirmar();
  fireEvent.click(screen.getByRole('button', { name: 'Reabrindo…' }));
  expect(api.reabrirFechamento).toHaveBeenCalledTimes(1);
  api.getFechamento.mockResolvedValue({ dados: { estado: 'aberta' } });
  await act(async () => resolver({ ok: true, result: { snapshot: { estado: 'aberta' } } }));
  expect(await screen.findByText('Editor de retificação')).toBeVisible();
  expect(api.getFechamento).toHaveBeenCalledTimes(2);
  expect(feedback.notifySuccess).toHaveBeenCalledTimes(1);
});
it('resposta antiga não abre editor nem publica erro na nova competência', async () => {
  let rejeitar;
  const api = cliente(jest.fn(() => new Promise((_, reject) => { rejeitar = reject; })));
  const view = render(tela(api));
  await confirmar();
  view.rerender(tela(api, '2026-10'));
  await act(async () => rejeitar(Error('erro da competência anterior')));
  expect(feedback.notifyError).not.toHaveBeenCalled();
  expect(screen.queryByText('Editor de retificação')).not.toBeInTheDocument();
});
it('recusa de leitura não aparece como competência aberta', async () => {
  const api = cliente();
  api.getFechamento.mockResolvedValue({ ok: false, message: 'Competência indisponível' });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(tela(api));
  expect(await screen.findByRole('alert')).toHaveTextContent('Competência indisponível');
  expect(feedback.notifyError).toHaveBeenCalledWith('Competência indisponível');
  log.mockRestore();
});

it.each(['falha', 'contradicao'])('POST confirmado com GET %s permite somente repetir leitura', async modo => {
  const api = cliente(jest.fn(async () => ({ ok: true, result: { snapshot: { estado: 'aberta' } } })));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(tela(api));
  await screen.findByRole('button', { name: 'Retificar' });
  if (modo === 'falha') api.getFechamento.mockRejectedValueOnce(Error('Leitura indisponível'));
  else api.getFechamento.mockResolvedValueOnce({ dados: { estado: 'transmitida' } });
  await confirmar();
  await waitFor(() => expect(api.getFechamento).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Editor de retificação')).not.toBeInTheDocument();
  expect(feedback.notifySuccess).not.toHaveBeenCalled();
  expect(await screen.findByText(/Reabertura confirmada; falta conferir/)).toBeVisible();
  api.getFechamento.mockResolvedValue({ dados: { estado: 'aberta' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
  expect(await screen.findByText('Editor de retificação')).toBeVisible();
  expect(api.reabrirFechamento).toHaveBeenCalledTimes(1);
  expect(api.getFechamento).toHaveBeenCalledTimes(3);
  log.mockRestore();
});

it.each(['retorno', 'desmontagem'])('reabertura tardia ignora geração anterior: %s', async modo => {
  let resolver;
  const api = cliente(jest.fn(() => new Promise(resolve => { resolver = resolve; })));
  const view = render(tela(api));
  await confirmar();
  if (modo === 'desmontagem') view.unmount();
  else {
    view.rerender(tela(api, '2026-10'));
    await screen.findByRole('button', { name: 'Retificar' });
    view.rerender(tela(api));
    await screen.findByRole('button', { name: 'Retificar' });
  }
  const leituras = api.getFechamento.mock.calls.length;
  await act(async () => resolver({ ok: true, result: { snapshot: { estado: 'aberta' } } }));
  expect(api.getFechamento).toHaveBeenCalledTimes(leituras);
  expect(feedback.notifySuccess).not.toHaveBeenCalled();
  expect(feedback.notifyError).not.toHaveBeenCalled();
  expect(screen.queryByText('Editor de retificação')).not.toBeInTheDocument();
});

it('conferência antiga não libera operação da competência atual', async () => {
  let resolverAntigo, resolverAtual;
  const api = cliente();
  api.getFechamento.mockResolvedValue({ dados: { estado: 'erro_transmissao' } });
  api.conferirTransmissaoFechamento = jest.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolverAntigo = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolverAtual = resolve; }));
  const view = render(tela(api));
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir envio na Receita' }));
  view.rerender(tela(api, '2026-10'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir envio na Receita' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Conferir envio na Receita' }));
  await act(async () => resolverAntigo({ ok: true, result: { confirmada: true, mensagem: 'antiga' } }));
  expect(screen.getByRole('button', { name: 'Conferir envio na Receita' })).toBeDisabled();
  expect(feedback.notifySuccess).not.toHaveBeenCalled();
  await act(async () => resolverAtual({ ok: true, result: { confirmada: true, mensagem: 'atual' } }));
  expect(feedback.notifySuccess).toHaveBeenCalledWith('atual');
});
