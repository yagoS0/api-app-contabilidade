import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfigurarRecorrencia, ListaRecorrencias } from '@contabilidade/shared/nfse-recorrencias';

const modelo = { tomador: { nome: 'Cliente mensal', doc: '11222333000181' }, servico: { descricao: 'Serviço mensal', valorServicos: 2500 } };
beforeEach(() => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => '12345678-1234-4123-8123-123456789012' });
});
afterEach(() => jest.restoreAllMocks());
test('autoriza recorrência sem chamar emissão avulsa e impede segundo salvamento', async () => {
  const api = { criarRecorrenciaNfse: jest.fn(async () => ({ id: 'r' })), emitirNfse: jest.fn() };
  render(<ConfigurarRecorrencia api={api} companyId="empresa" obterModelo={() => modelo} />);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Dia mensal'), { target: { value: '31' } });
  fireEvent.change(screen.getByLabelText('Primeira emissão'), { target: { value: '2026-10-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Conferir e autorizar recorrência' }));
  await screen.findByRole('button', { name: 'Recorrência salva' });
  expect(api.criarRecorrenciaNfse).toHaveBeenCalledWith('empresa', expect.objectContaining({ dia: 31, inicio: '2026-10-31', modelo, confirmada: true }));
  expect(api.emitirNfse).not.toHaveBeenCalled();
  expect(window.confirm.mock.calls[0][0]).toContain('Cliente mensal');
  expect(screen.getByRole('button', { name: 'Recorrência salva' })).toBeDisabled();
});
test('não salva sem confirmação nem com formulário inválido', () => {
  const api = { criarRecorrenciaNfse: jest.fn() };
  render(<ConfigurarRecorrencia api={api} companyId="empresa" obterModelo={() => modelo} disabled />);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Conferir e autorizar recorrência' })).toBeDisabled();
  expect(api.criarRecorrenciaNfse).not.toHaveBeenCalled();
});
test('lista distingue worker desligado e permite pausar', async () => {
  const api = { listarRecorrenciasNfse: jest.fn(async () => ({ workerAtivo: false, items: [{ id: 'r', ativa: true, dia: 31, proximaData: '2026-10-31', ambiente: 'homolog', modelo, execucoes: [] }] })), alterarRecorrenciaNfse: jest.fn(async () => ({})) };
  render(<ListaRecorrencias api={api} companyId="empresa" />);
  fireEvent.click(screen.getByText(/Notas recorrentes/));
  await screen.findByText(/emissão automática está desligada/);
  fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
  await waitFor(() => expect(api.alterarRecorrenciaNfse).toHaveBeenCalledWith('empresa', 'r', 'pausar', expect.any(Object)));
});

test('bloqueia datas de retomada durante operação e libera após recusa sem alterar payload', async () => {
  let recusar;
  const api = {
    listarRecorrenciasNfse: jest.fn(async () => ({ items: [
      { id: 'r', ativa: false, dia: 15, proximaData: '2026-10-15', modelo, execucoes: [] },
      { id: 's', ativa: false, dia: 15, proximaData: '2026-10-15', modelo: { ...modelo, tomador: { nome: 'Outro cliente' } }, execucoes: [] },
    ] })),
    alterarRecorrenciaNfse: jest.fn(() => new Promise((resolve, reject) => { recusar = reject; })),
  };
  render(<ListaRecorrencias api={api} companyId="empresa" embutida />);
  const data = await screen.findByLabelText('Retomar Cliente mensal');
  const outraData = screen.getByLabelText('Retomar Outro cliente');
  fireEvent.change(data, { target: { value: '2026-11-15' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Retomar' })[0]);
  expect(data).toBeDisabled();
  expect(outraData).toBeDisabled();
  expect(api.alterarRecorrenciaNfse).toHaveBeenCalledTimes(1);
  expect(api.alterarRecorrenciaNfse).toHaveBeenCalledWith('empresa', 'r', 'retomar', { inicio: '2026-11-15', confirmada: true });
  recusar(new Error('Permissão revogada.'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Permissão revogada.');
  expect(data).toBeEnabled();
  expect(outraData).toBeEnabled();
  expect(data).toHaveValue('2026-11-15');
});
