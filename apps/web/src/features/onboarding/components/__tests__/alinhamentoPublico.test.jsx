import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { FormularioPublico } from '../../pages/FormularioPublico';
import { formatarValor } from '../PassoRevisao.shared.js';
import { validarDadosOnboarding, reconciliarDados, proximaPerguntaOnboarding } from '@contabilidade/shared/onboarding-dados';

function iniciar(dados = {}, passo = 'situacao', origem = 'TRANSFERENCIA') {
  window.history.replaceState(null, '', '/onboarding/publico#token=teste');
  const onboarding = { origem, dados, versao: 1, ultimoPasso: passo };
  const api = { consultarFormularioOnboarding: jest.fn().mockResolvedValue({ onboarding }), salvarFormularioOnboarding: jest.fn().mockImplementation(async (_, p) => ({ onboarding: { ...onboarding, ...p, versao: p.versao + 1 } })) };
  render(<FormularioPublico api={api} />);
  return { api, onboarding };
}

test('comparação de lista preserva zero e resposta negativa', () => {
  expect(formatarValor({ tipo: 'lista', colunas: [{ campo: 'nome' }, { campo: 'participacao' }, { campo: 'administrador' }] }, [{ nome: 'Ana', participacao: 0, administrador: false }])).toBe('Ana · 0 · Não');
});

test('bloqueia quantidade negativa e salva números normalizados sem perder zero e desconhecimento', async () => {
  const { api } = iniciar();
  fireEvent.change(await screen.findByLabelText('Quantidade de funcionários'), { target: { value: '-2' } });
  fireEvent.click(screen.getByText('Salvar e continuar'));
  expect(await screen.findByText(/uma quantidade inteira/)).toBeInTheDocument();
  expect(api.salvarFormularioOnboarding).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Quantidade de funcionários'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Média de notas emitidas por mês'), { target: { value: '25' } });
  fireEvent.change(screen.getByLabelText('Faturamento mensal aproximado (R$)'), { target: { value: '10.500,50' } });
  fireEvent.change(screen.getByLabelText('Como responder: o titular ou algum sócio recebe uma remuneração pelo trabalho na empresa?'), { target: { value: 'NAO_SEI' } });
  fireEvent.click(screen.getByText('Salvar e continuar'));
  await waitFor(() => expect(api.salvarFormularioOnboarding).toHaveBeenCalledWith('teste', expect.objectContaining({ dados: { qtdFuncionarios: 0, notasEmitidasMes: 25, faturamentoMensal: 10500.5, temProLabore: 'NAO_SEI' } })));
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
  fireEvent.click(await screen.findByRole('button', { name: 'Manter minha resposta' }));
  expect(screen.getByLabelText('Quantidade de funcionários')).toHaveValue('3');
  expect(screen.getByLabelText('Média de notas emitidas por mês')).toHaveValue('30');
  fireEvent.click(screen.getByText('Salvar e continuar'));
  await waitFor(() => expect(api.salvarFormularioOnboarding).toHaveBeenLastCalledWith('teste', expect.objectContaining({ versao: 2, dados: { qtdFuncionarios: 3, notasEmitidasMes: 30 } })));
});

test('corrigir erro complementar mantém seção aberta e campo focado', async () => {
  const { api } = iniciar({ responsavelCpf: '123' }, 'responsavel', 'PESSOA_FISICA');
  const cpf = await screen.findByLabelText('CPF (opcional neste momento)');
  const secao = cpf.closest('details');
  expect(secao).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('Salvar e continuar'));
  await waitFor(() => expect(secao).toHaveAttribute('open'));
  cpf.focus();
  fireEvent.change(cpf, { target: { value: '1234' } });
  expect(secao).toHaveAttribute('open');
  expect(cpf).toHaveFocus();
  fireEvent.change(cpf, { target: { value: '52998224725' } });
  expect(secao).toHaveAttribute('open');
  fireEvent.click(screen.getByText('Salvar para continuar depois'));
  await waitFor(() => expect(api.salvarFormularioOnboarding).toHaveBeenCalledWith('teste', expect.objectContaining({ dados: { responsavelCpf: '52998224725' } })));
});

test('compara valores humanos fora dos botões e preserva a resposta escolhida', async () => {
  const { api, onboarding } = iniciar({ faturamentoMensal: 1000 });
  fireEvent.change(await screen.findByLabelText('Faturamento mensal aproximado (R$)'), { target: { value: '2000' } });
  api.salvarFormularioOnboarding.mockRejectedValueOnce(Object.assign(Error('A ficha mudou'), { status: 409 }));
  fireEvent.click(screen.getByText('Salvar e continuar'));
  const recuperar = await screen.findByText('Verificar salvamento e recuperar respostas');
  api.consultarFormularioOnboarding.mockResolvedValue({ onboarding: { ...onboarding, versao: 2, dados: { faturamentoMensal: 3000 } } });
  fireEvent.click(recuperar);
  const comparacao = await screen.findByRole('region', { name: 'Faturamento mensal aproximado (R$)' });
  expect(within(comparacao).getByText(/R\$\s*2\.000,00/)).toBeInTheDocument();
  expect(within(comparacao).getByText(/R\$\s*3\.000,00/)).toBeInTheDocument();
  const usar = within(comparacao).getByRole('button', { name: 'Usar resposta atualizada' });
  expect(usar).not.toHaveTextContent('3000');
  fireEvent.click(usar);
  fireEvent.click(screen.getByText('Salvar e continuar'));
  await waitFor(() => expect(api.salvarFormularioOnboarding).toHaveBeenLastCalledWith('teste', expect.objectContaining({ dados: { faturamentoMensal: 3000 }, versao: 2 })));
});

test('resposta perdida no envio final confirma recebimento sem reenviar', async () => {
  const { api } = iniciar({ socios: [{ nome: 'Ana Teste', cpf: '52998224725' }] }, 'revisao');
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
