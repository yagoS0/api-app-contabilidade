import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
