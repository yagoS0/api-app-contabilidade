import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { OnboardingsPage } from "../../pages/renderOnboardingsPage";
const item = { id: "rascunho-teste", versao: 0, origem: "ABERTURA", status: "RASCUNHO", responsavelNome: "Contato de teste" };
function montar(descartarOnboarding = jest.fn(), extra = {}) {
  const api = { listarOnboardings: jest.fn().mockResolvedValue({ itens: [item] }), descartarOnboarding,
    getElegibilidadeDescarteOnboarding: jest.fn().mockResolvedValue({ ok: true, elegibilidade: { id: item.id, versao: 0, podeExcluir: true, podeEncerrar: true, impedimentos: [] } }), ...extra };
  render(<OnboardingsPage api={api} onAbrir={jest.fn()} />);
  return api;
}
async function abrir() {
  fireEvent.click(await screen.findByLabelText('Ações de Contato de teste'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir rascunho' }));
  const confirmar = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir rascunho' });
  await waitFor(() => expect(confirmar).toBeEnabled());
  return confirmar;
}
test('cancelar não chama exclusão', async () => {
  const api = montar(); await abrir();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(api.descartarOnboarding).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Ações de Contato de teste')).toHaveFocus();
});
test('vínculo criado depois da prévia mantém a ficha e erro recuperável', async () => {
  const api = montar(jest.fn().mockRejectedValue(new Error('Conversa vinculada. Use desistência para preservar o histórico.')));
  fireEvent.click(await abrir());
  expect(await screen.findByRole('alert')).toHaveTextContent('Conversa vinculada');
  expect(screen.getByRole('button', { name: 'Conferir novamente' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Contato de teste' })).toBeInTheDocument();
  expect(api.descartarOnboarding).toHaveBeenCalledTimes(1);
});
test('exclusão confirmada atualiza lista e contador sem releitura', async () => {
  const api = montar(jest.fn().mockResolvedValue({ ok: true }));
  fireEvent.click(await abrir());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Contato de teste' })).not.toBeInTheDocument();
  expect(api.descartarOnboarding).toHaveBeenCalledWith(item.id, 0);
  expect(screen.getByRole('button', { name: 'Em andamento 0' })).toBeVisible();
  expect(screen.getByLabelText('Buscar atendimento')).toHaveFocus();
});

test.each([undefined, { ok: false }, {}])('exclusão sem confirmação não remove ficha nem contador: %j', async retorno => {
  montar(jest.fn().mockResolvedValue(retorno));
  fireEvent.click(await abrir());
  expect(await screen.findByRole('alert')).toHaveTextContent('Resposta sem confirmação');
  expect(screen.getByRole('button', { name: 'Contato de teste' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Em andamento 1' })).toBeInTheDocument();
});

test('encerramento na lista legada atualiza contadores e conserva ficha em Encerrados', async () => {
  const api = montar(jest.fn(), { desistirOnboarding: jest.fn().mockResolvedValue({
    ok: true, onboarding: { ...item, versao: 1, status: 'DESISTIU', motivoDesistencia: 'Sem interesse' },
  }) });
  fireEvent.click(await screen.findByLabelText('Ações de Contato de teste'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  const confirmar = screen.getByRole('button', { name: 'Confirmar desistência' });
  await waitFor(() => expect(confirmar).toBeEnabled());
  fireEvent.click(confirmar);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Em andamento 0' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Contato de teste' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Buscar atendimento')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Encerrados 1' }));
  expect(screen.getByRole('button', { name: 'Contato de teste' })).toBeVisible();
  expect(api.listarOnboardings).toHaveBeenCalledTimes(1);
  expect(api.descartarOnboarding).not.toHaveBeenCalled();
});
