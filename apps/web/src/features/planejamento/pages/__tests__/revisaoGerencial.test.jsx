import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BaseGerencial } from '../../components/BaseGerencial';
import { PendenciasRelatorio } from '../../components/PendenciasRelatorio';

test('aplica apenas nas selecionadas e preserva conta fora do período', async () => {
  const fora = { comportamento: 'VARIAVEL', prolabore: false };
  const api = { getClassificacaoGerencial: jest.fn(async () => ({ contas: { '999999': fora }, revisao: 7 })), salvarClassificacaoGerencial: jest.fn(async (_, r) => ({ ...r, revisao: 8 })) };
  const dre = { linhas: [{ chave: 'receitaBruta', valor: 1000 }, { chave: 'gerais', contas: [{ codigo: '41102001', nome: 'Conta A', valor: -100 }, { codigo: '41102002', nome: 'Conta B', valor: -200 }] }] };
  render(<BaseGerencial api={api} empresaId="a" dre={dre}/>);
  fireEvent.click(await screen.findByText('Classificar contas gerenciais'));
  fireEvent.click(screen.getByLabelText('Selecionar Conta A 41102001'));
  fireEvent.click(screen.getByText('Aplicar fixo'));
  expect(screen.getByLabelText('Comportamento 41102001')).toHaveValue('FIXO');
  expect(screen.getByLabelText('Comportamento 41102002')).toHaveValue('');
  expect(api.salvarClassificacaoGerencial).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Filtrar contas'), { target: { value: 'pendentes' } });
  expect(screen.queryByLabelText('Selecionar Conta A 41102001')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Selecionar contas visíveis'));
  fireEvent.click(screen.getByText('Aplicar variável'));
  fireEvent.click(screen.getByText('Salvar classificação'));
  await waitFor(() => expect(api.salvarClassificacaoGerencial).toHaveBeenCalledWith('a', { revisao: 7, contas: { '999999': fora, '41102001': { comportamento: 'FIXO', prolabore: false }, '41102002': { comportamento: 'VARIAVEL', prolabore: false } } }));
});

test('identifica período e origem da pendência sem declarar completude', () => {
  render(<PendenciasRelatorio empresaId="a" dados={{ hoje: '2026-09-16', atual: { ate: '2026-08', faltas: { guias: ['2026-08'] }, dre: { qualidade: { lancamentosRascunho: 2 } } }, anterior: { ate: '2026-07', faltas: { faturamento: ['2026-07'] } } }}/>);
  expect(screen.getByText('Sem registros de guias: 08/2026')).toBeInTheDocument();
  expect(screen.getByText('Sem registros de faturamento: 07/2026')).toBeInTheDocument();
  expect(screen.getByText('2 lançamento(s) em rascunho')).toBeInTheDocument();
  expect(screen.getByText('Conferir guias')).toHaveAttribute('href', '/companies/a/guides');
  expect(screen.queryByText('O período inclui mês ainda não encerrado')).not.toBeInTheDocument();
});
