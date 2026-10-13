import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormularioPublico } from '../../pages/FormularioPublico';
import { validarDadosOnboarding, reconciliarDados, proximaPerguntaOnboarding } from '@contabilidade/shared/onboarding-dados';

function iniciar(dados = {}, passo = 'situacao') {
  window.history.replaceState(null, '', '/onboarding/publico#token=teste');
  const onboarding = { origem: 'TRANSFERENCIA', dados, versao: 1, ultimoPasso: passo };
  const api = { consultarFormularioOnboarding: jest.fn().mockResolvedValue({ onboarding }), salvarFormularioOnboarding: jest.fn().mockImplementation(async (_, p) => ({ onboarding: { ...onboarding, ...p, versao: p.versao + 1 } })) };
  render(<FormularioPublico api={api} />);
  return { api, onboarding };
}

test('bloqueia quantidade negativa e salva números normalizados sem perder zero e desconhecimento', async () => {
  const { api } = iniciar();
  fireEvent.change(await screen.findByLabelText('Quantidade de funcionários'), { target: { value: '-2' } });
  fireEvent.click(screen.getByText('Salvar e continuar'));
  expect(await screen.findByText(/uma quantidade inteira/)).toBeInTheDocument();
  expect(api.salvarFormularioOnboarding).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Quantidade de funcionários'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Média de notas emitidas por mês'), { target: { value: '25' } });
  fireEvent.change(screen.getByLabelText('Faturamento mensal aproximado (R$)'), { target: { value: '10.500,50' } });
  fireEvent.change(screen.getByLabelText('Como responder: notas recebidas e despesas por mês'), { target: { value: 'NAO_SEI' } });
  fireEvent.click(screen.getByText('Salvar e continuar'));
  await waitFor(() => expect(api.salvarFormularioOnboarding).toHaveBeenCalledWith('teste', expect.objectContaining({ dados: { qtdFuncionarios: 0, notasEmitidasMes: 25, faturamentoMensal: 10500.5, notasRecebidasMes: 'NAO_SEI' } })));
  expect(await screen.findByText('Não sei / preciso confirmar')).toBeInTheDocument();
});

test('e-mail inválido fica junto ao campo e não segue para o servidor', async () => {
  const { api } = iniciar({}, 'responsavel');
  fireEvent.change(await screen.findByLabelText(/E-mail do responsável/), { target: { value: 'invalido' } });
  fireEvent.click(screen.getByText('Salvar e continuar'));
  expect(await screen.findByText('Confira e-mail do responsável.')).toBeInTheDocument();
  expect(api.salvarFormularioOnboarding).not.toHaveBeenCalled();
});

test('conflito preserva edição local e exige escolha antes de salvar a versão atual', async () => {
  const { api, onboarding } = iniciar({ qtdFuncionarios: 2, notasEmitidasMes: 10 });
  fireEvent.change(await screen.findByLabelText('Quantidade de funcionários'), { target: { value: '3' } });
  api.salvarFormularioOnboarding.mockRejectedValueOnce(Object.assign(Error('A ficha mudou'), { status: 409 }));
  fireEvent.click(screen.getByText('Salvar e continuar'));
  const recuperar = await screen.findByText('Verificar salvamento e recuperar respostas');
  api.consultarFormularioOnboarding.mockResolvedValue({ onboarding: { ...onboarding, versao: 2, dados: { qtdFuncionarios: 4, notasEmitidasMes: 30 } } });
  fireEvent.click(recuperar);
  fireEvent.click(await screen.findByText('Manter minha resposta: 3'));
  expect(screen.getByLabelText('Quantidade de funcionários')).toHaveValue('3');
  expect(screen.getByLabelText('Média de notas emitidas por mês')).toHaveValue('30');
  fireEvent.click(screen.getByText('Salvar e continuar'));
  await waitFor(() => expect(api.salvarFormularioOnboarding).toHaveBeenLastCalledWith('teste', expect.objectContaining({ versao: 2, dados: { qtdFuncionarios: 3, notasEmitidasMes: 30 } })));
});

test('resposta perdida no envio final confirma recebimento sem reenviar', async () => {
  const { api } = iniciar({}, 'revisao');
  fireEvent.click(await screen.findByRole('checkbox'));
  api.salvarFormularioOnboarding.mockRejectedValueOnce(Error('Falha de rede'));
  fireEvent.click(screen.getByText('Enviar cadastro ao escritório'));
  const recuperar = await screen.findByText('Verificar salvamento e recuperar respostas');
  api.consultarFormularioOnboarding.mockResolvedValue({ enviado: true });
  fireEvent.click(recuperar);
  expect(await screen.findByText('Cadastro enviado. O escritório dará continuidade ao atendimento.')).toBeInTheDocument();
  expect(api.salvarFormularioOnboarding).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe('');
});

test('IA utiliza respostas do link e desconhecimento não vira zero', () => {
  const ficha = { origem: 'TRANSFERENCIA', dados: { cnpj: '11222333000181', responsavelNome: 'Ana', modalidadeServico: 'RECORRENTE', qtdFuncionarios: 0, notasRecebidasMes: 'NAO_SEI', notasEmitidasMes: 15 } };
  expect(proximaPerguntaOnboarding(ficha).campo).toBe('faturamentoMensal');
  expect(validarDadosOnboarding('TRANSFERENCIA', ficha.dados).dados.qtdFuncionarios).toBe(0);
  expect(reconciliarDados({ qtdFuncionarios: 2 }, { qtdFuncionarios: 3 }, { qtdFuncionarios: 2, notasEmitidasMes: 10 })).toEqual({ dados: { qtdFuncionarios: 3, notasEmitidasMes: 10 }, conflitos: [] });
});
