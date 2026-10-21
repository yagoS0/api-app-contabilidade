import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingDetailPage } from '../../onboarding/pages/renderOnboardingDetailPage';

test('ficha convertida mantém implantação editável na empresa, sem reabrir ou gravar a ficha histórica', async () => {
  const tarefa = { chave: 'documentos', titulo: 'Conferir documentos', status: 'A_FAZER', pendencia: 'Falta contrato', versao: 0, historico: [] };
  const dados = { tarefas: [tarefa], resumo: { pendentes: 1, atrasadas: 0, semResponsavel: 1, concluidas: 0 } };
  const api = {
    getOnboarding: async () => ({ onboarding: { id: 'o1', origem: 'TRANSFERENCIA', status: 'CONVERTIDO', portalClientId: 'p1', razaoSocial: 'Empresa teste', dados: {}, etapas: [] } }),
    getImplantacao: jest.fn(async () => ({ implantacao: dados })),
    salvarImplantacao: jest.fn(async () => ({ implantacao: { ...dados, tarefas: [{ ...tarefa, versao: 1, responsavel: 'Ana' }] } })),
    salvarEtapaOnboarding: jest.fn(),
    getPerfisEmissao: async () => ({ perfis: [], emissaoCliente: { liberada: false } }),
  };
  render(<OnboardingDetailPage api={api} onboardingId="o1" />);
  expect(await screen.findByRole('link', { name: 'Abrir implantação na empresa' })).toHaveAttribute('href', '/companies/p1/implantacao');
  fireEvent.click(await screen.findByRole('button', { name: /Atualizar tarefa/ }));
  fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'Ana' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar tarefa' }));
  await waitFor(() => expect(api.salvarImplantacao).toHaveBeenCalledWith('p1', 'documentos', expect.objectContaining({ responsavel: 'Ana' })));
  expect(api.salvarEtapaOnboarding).not.toHaveBeenCalled();
});

test('destino da jornada abre execução na ficha sem salvar nem concluir', async () => {
  const ficha = { id: 'servico-qa', origem: 'PESSOA_FISICA', status: 'RECEBIDO', versao: 1, responsavelNome: 'Pessoa QA', dados: {}, etapas: [] };
  const estado = { onboarding: ficha, propostas: [], contratos: [], documentos: [], trabalhos: [], jornada: { projecao: { atual: 'conclusao', pessoaFisica: true, passos: [], contrato: { id: 'c-qa', dados: { opcao: { recorrente: false } } } } } };
  const api = {
    getOnboarding: jest.fn(async () => ({ onboarding: ficha })),
    getOnboardingComercial: jest.fn(async () => ({ links: [], eventos: [], analises: [] })),
    comercial: jest.fn(async path => path === '/recursos' ? { recursos: [] } : path.endsWith('/acompanhamento') ? { versao: 1 } : estado),
  };
  render(<MemoryRouter><OnboardingDetailPage api={api} onboardingId={ficha.id} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir execução do serviço' }));
  expect(screen.getByRole('region', { name: 'Execução do serviço' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Execução do serviço' })).toHaveAttribute('aria-pressed', 'true');
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});

test('link do chat com destino de execução abre a área correta', async () => {
  history.replaceState(null, '', '/onboardings/servico-qa#implantacao');
  try {
    const api = { getOnboarding: jest.fn(async () => ({ onboarding: { id: 'servico-qa', origem: 'PESSOA_FISICA', status: 'RECEBIDO', versao: 1, dados: {}, etapas: [] } })) };
    render(<OnboardingDetailPage api={api} onboardingId="servico-qa" />);
    expect(await screen.findByRole('region', { name: 'Execução do serviço' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Execução do serviço' })).toHaveAttribute('aria-pressed', 'true');
  } finally { history.replaceState(null, '', '/'); }
});
