import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApuracaoPage } from '../renderApuracaoPage';
import { useApuracao } from '../../hooks/useApuracao';

jest.mock('../../../../components/layout/AppShell', () => ({ AppShell: ({ children }) => <div>{children}</div> }));
jest.mock('../../../../components/layout/PageShell', () => ({ PageShell: ({ children }) => <main>{children}</main> }));
jest.mock('../../components/BatchProgressModal', () => ({ BatchProgressModal: () => <div>Lote em andamento</div> }));
const fechada = { portalClientId: 'a', razao: 'Empresa A', estado: 'fechada' };
function Tela({ api }) { const panel = useApuracao({ api }); return <ApuracaoPage apuracaoPanel={panel} />; }

test('trocar mês retira seleção da tela e mantém envio desabilitado até nova seleção', async () => {
  let resolver;
  const api = { listApuracao: jest.fn(async () => ({ items: [fechada] })), criarApuracaoBatch: jest.fn() };
  render(<Tela api={api} />);
  await screen.findByText('Empresa A');
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar fechadas' }));
  expect(screen.getByRole('button', { name: /Apurar em lote/ })).toBeEnabled();
  api.listApuracao.mockImplementationOnce(() => new Promise(r => { resolver = r; }));
  fireEvent.change(screen.getByLabelText('Competência:'), { target: { value: '2020-03' } });
  expect(screen.queryByText('Empresa A')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Apurar em lote/ })).toBeDisabled();
  await act(async () => resolver({ items: [fechada] }));
  expect(screen.getByRole('button', { name: /Apurar em lote/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar fechadas' }));
  expect(screen.getByRole('button', { name: /Apurar em lote/ })).toBeEnabled();
});

test('lote pendente desabilita envio e caixas de seleção', async () => {
  let resolver;
  const api = { listApuracao: jest.fn(async () => ({ items: [fechada] })), criarApuracaoBatch: jest.fn(() => new Promise(r => { resolver = r; })) };
  render(<Tela api={api} />); await screen.findByText('Empresa A');
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar fechadas' }));
  fireEvent.click(screen.getByRole('button', { name: /Apurar em lote/ }));
  expect(screen.getByRole('button', { name: 'Iniciando lote…' })).toBeDisabled();
  for (const caixa of screen.getAllByRole('checkbox')) expect(caixa).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Iniciando lote…' }));
  expect(api.criarApuracaoBatch).toHaveBeenCalledTimes(1);
  await act(async () => resolver({ ok: true, taskId: 'tarefa' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Apurar em lote/ })).toBeDisabled());
});

test('erro de carregamento não afirma carteira vazia', async () => {
  const api = { listApuracao: jest.fn(async () => { throw new Error('Falha na leitura'); }) };
  render(<Tela api={api} />); await screen.findByText('Falha na leitura');
  expect(screen.queryByText('Nenhuma empresa encontrada.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Apurar em lote/ })).toBeDisabled();
});

test('declaração externa aparece sem inventar fechamento interno', async () => {
  const api = { listApuracao: jest.fn(async () => ({ items: [{ portalClientId: 'externa', razao: 'Empresa externa', estado: 'aberta', entregaPgdas: { numeroDeclaracaoRfb: '123', extratoStatus: 'SUCCESS' } }] })) };
  render(<Tela api={api} />);
  await screen.findByText('Entrega confirmada na Receita');
  expect(screen.getByText('aberta')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Apurar em lote/ })).toBeDisabled();
});
