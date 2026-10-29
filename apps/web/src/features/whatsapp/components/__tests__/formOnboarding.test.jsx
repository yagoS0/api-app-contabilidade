import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FormOnboarding } from "../FormOnboarding";
const conversa = { id: "c1", telefoneE164: "5511977776666", nomePerfilProvedor: "Carlos", portalClientId: null };
const vazio = { situacao: "SEM_ONBOARDING", candidatos: [] };
function montar(api, props = {}) { return render(<FormOnboarding api={api} conversa={conversa} mensagens={[{ direcao: "in" }]} leitura={vazio} {...props} />); }
function apiMock() { return { getOnboarding: jest.fn().mockResolvedValue({ onboarding: { id: "o1", versao: 0, status: "RASCUNHO", dados: {} } }), listarOnboardings: jest.fn().mockResolvedValue({ itens: [] }), criarOnboarding: jest.fn().mockResolvedValue({ onboarding: { id: "o1", versao: 0 } }), salvarOnboarding: jest.fn().mockResolvedValue({ onboarding: { id: "o1", versao: 1, origem: "ABERTURA", status: "RASCUNHO" } }) }; }
test("exige origem escolhida e reaproveita criar/PATCH sem mandar origem no PATCH", async () => {
  const api = apiMock(); montar(api);
  expect(screen.getByRole("button", { name: "Virar onboarding" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Abertura" }));
  fireEvent.click(screen.getByRole("button", { name: "Virar onboarding" }));
  await screen.findByText(/A conversa continua sem empresa/);
  expect(api.criarOnboarding).toHaveBeenCalledWith("ABERTURA");
  expect(api.salvarOnboarding).toHaveBeenCalledWith("o1", { versao: 0, dados: { responsavelNome: "Carlos", responsavelTelefone: "+5511977776666" } });
  expect(screen.getByRole("link", { name: "Completar a ficha" })).toHaveAttribute("href", "/onboardings/o1/editar");
});
test("PATCH falho retenta o mesmo rascunho, sem segunda criação", async () => {
  const api = apiMock(); api.salvarOnboarding.mockRejectedValueOnce(new Error("offline")); montar(api);
  fireEvent.click(screen.getByRole("button", { name: "Transferência" }));
  fireEvent.click(screen.getByRole("button", { name: "Virar onboarding" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Tentar preencher a ficha novamente" }));
  await waitFor(() => expect(api.salvarOnboarding).toHaveBeenCalledTimes(2));
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
});
test("quem não escreveu não pode virar onboarding", () => {
  const api = apiMock(); montar(api, { mensagens: [{ direcao: "out" }] });
  fireEvent.click(screen.getByRole("button", { name: "Abertura" }));
  expect(screen.getByRole("button", { name: "Virar onboarding" })).toBeDisabled(); expect(api.criarOnboarding).not.toHaveBeenCalled();
});
test("releitura encontra ficha criada por outro atendimento e impede duplicação", async () => {
  const api = apiMock(); api.listarOnboardings.mockResolvedValue({ itens: [{ id: "existente", origem: "INATIVA", status: "RECEBIDO", responsavelTelefone: "+5511977776666" }] }); montar(api);
  fireEvent.click(screen.getByRole("button", { name: "Abertura" })); fireEvent.click(screen.getByRole("button", { name: "Virar onboarding" }));
  await screen.findByRole("link", { name: /Abrir onboarding INATIVA/ }); expect(api.criarOnboarding).not.toHaveBeenCalled();
});
test("falha de leitura bloqueia a oferta e diz o motivo", () => {
  montar(apiMock(), { leitura: { situacao: "DESCONHECIDO", candidatos: [] } });
  expect(screen.queryByRole("button", { name: "Virar onboarding" })).toBeNull();
  expect(screen.getByText(/Confira os onboardings antes/)).toBeInTheDocument();
});

test.each([new Error("resposta perdida"), null])("criação sem confirmação não permite repetir POST (%s)", async (falha) => {
  const api = apiMock();
  if (falha) api.criarOnboarding.mockRejectedValueOnce(falha);
  else api.criarOnboarding.mockResolvedValueOnce({ ok: true });
  montar(api);
  fireEvent.click(screen.getByRole("button", { name: "Abertura" }));
  fireEvent.click(screen.getByRole("button", { name: "Virar onboarding" }));
  await screen.findByRole("link", { name: /Confira os rascunhos/ });
  expect(screen.queryByRole("button", { name: "Virar onboarding" })).toBeNull();
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
  expect(api.salvarOnboarding).not.toHaveBeenCalled();
});
test("falha na releitura antes do POST permite tentar a conferência novamente", async () => {
  const api = apiMock(); api.listarOnboardings.mockRejectedValueOnce(new Error("offline")); montar(api);
  fireEvent.click(screen.getByRole("button", { name: "Abertura" }));
  fireEvent.click(screen.getByRole("button", { name: "Virar onboarding" }));
  await screen.findByRole("alert");
  expect(api.criarOnboarding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Virar onboarding" }));
  await screen.findByText(/A conversa continua sem empresa/);
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
});
test.each(["ABERTA", "EXPIRADA"])("a janela %s prova inbound anterior mesmo fora da página carregada", async (situacao) => {
  const api = apiMock(); montar(api, { mensagens: [{ direcao: "out" }], conversa: { ...conversa, janela: { situacao } } });
  fireEvent.click(screen.getByRole("button", { name: "Abertura" }));
  fireEvent.click(screen.getByRole("button", { name: "Virar onboarding" }));
  await screen.findByText(/A conversa continua sem empresa/);
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
});

test("retentativa preserva ficha preenchida em outra aba após falha do PATCH", async () => {
  const api = apiMock();
  api.salvarOnboarding.mockRejectedValueOnce(new Error("resposta perdida"));
  api.getOnboarding.mockResolvedValue({ onboarding: { id: "o1", versao: 1, origem: "ABERTURA", status: "RASCUNHO", dados: { responsavelNome: "Nome corrigido", razaoSocial: "Empresa preenchida" } } });
  montar(api);
  fireEvent.click(screen.getByRole("button", { name: "Abertura" }));
  fireEvent.click(screen.getByRole("button", { name: "Virar onboarding" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Tentar preencher a ficha novamente" }));
  await screen.findByRole("link", { name: "Completar a ficha" });
  expect(api.getOnboarding).toHaveBeenCalledWith("o1");
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
  expect(api.salvarOnboarding).toHaveBeenCalledTimes(1);
});
test("falha na conferência do rascunho impede PATCH de retentativa", async () => {
  const api = apiMock();
  api.salvarOnboarding.mockRejectedValueOnce(new Error("primeira falha"));
  api.getOnboarding.mockRejectedValueOnce(new Error("falha ao conferir"));
  montar(api);
  fireEvent.click(screen.getByRole("button", { name: "Abertura" }));
  fireEvent.click(screen.getByRole("button", { name: "Virar onboarding" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Tentar preencher a ficha novamente" }));
  await screen.findByText(/falha ao conferir/);
  expect(api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
});

// Revisão é evidência recebida, nunca inferida da criação ou do número de tentativas.
test('envia revisão não zero recebida do POST e exige avanço no retorno', async () => {
  const api = apiMock();
  api.criarOnboarding.mockResolvedValue({ onboarding: { id: 'o1', versao: 7 } });
  api.salvarOnboarding.mockResolvedValue({ onboarding: { id: 'o1', versao: 8, origem: 'ABERTURA', status: 'RASCUNHO' } });
  montar(api);
  fireEvent.click(screen.getByRole('button', { name: 'Abertura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Virar onboarding' }));
  await screen.findByRole('link', { name: 'Completar a ficha' });
  expect(api.salvarOnboarding).toHaveBeenCalledWith('o1', { versao: 7, dados: { responsavelNome: 'Carlos', responsavelTelefone: '+5511977776666' } });
});

test('409 preserva rascunho e somente retry explícito usa revisão da releitura vazia', async () => {
  const api = apiMock(), onCriado = jest.fn();
  api.salvarOnboarding.mockRejectedValueOnce(Object.assign(new Error('Ficha alterada'), { code: 'formulario_alterado', status: 409 }))
    .mockResolvedValue({ onboarding: { id: 'o1', versao: 5, origem: 'ABERTURA', status: 'RASCUNHO' } });
  api.getOnboarding.mockResolvedValue({ onboarding: { id: 'o1', versao: 4, status: 'RASCUNHO', dados: {} } });
  montar(api, { onCriado });
  fireEvent.click(screen.getByRole('button', { name: 'Abertura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Virar onboarding' }));
  await screen.findByText(/Ficha alterada/);
  expect(onCriado).not.toHaveBeenCalled();
  expect(api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(api.getOnboarding).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Abrir o rascunho criado' })).toHaveAttribute('href', '/onboardings/o1/editar');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar preencher a ficha novamente' }));
  await screen.findByRole('link', { name: 'Completar a ficha' });
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
  expect(api.salvarOnboarding.mock.calls.map(([, patch]) => patch.versao)).toEqual([0, 4]);
  expect(onCriado).toHaveBeenCalledTimes(1);
});

test('POST sem revisão conserva id, bloqueia PATCH e não repete criação no retry', async () => {
  const api = apiMock();
  api.criarOnboarding.mockResolvedValue({ onboarding: { id: 'o1' } });
  montar(api);
  fireEvent.click(screen.getByRole('button', { name: 'Abertura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Virar onboarding' }));
  await screen.findByText(/Não foi possível conferir a revisão/);
  expect(api.salvarOnboarding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Tentar preencher a ficha novamente' }));
  await screen.findByRole('link', { name: 'Completar a ficha' });
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
  expect(api.getOnboarding).toHaveBeenCalledWith('o1');
  expect(api.salvarOnboarding.mock.calls[0][1].versao).toBe(0);
});

test.each([
  { id: 'outro', versao: 1 },
  { id: 'o1' },
  { id: 'o1', versao: 0 },
])('resposta PATCH incompatível mantém erro e não confirma sucesso: %j', async onboarding => {
  const api = apiMock(), onCriado = jest.fn();
  api.salvarOnboarding.mockResolvedValue({ onboarding });
  montar(api, { onCriado });
  fireEvent.click(screen.getByRole('button', { name: 'Abertura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Virar onboarding' }));
  await screen.findByText(/Não foi possível confirmar o preenchimento/);
  expect(onCriado).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'Completar a ficha' })).toBeNull();
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
});

test('releitura sem revisão não permite confirmar dados nem reenviar PATCH', async () => {
  const api = apiMock(), onCriado = jest.fn();
  api.salvarOnboarding.mockRejectedValueOnce(new Error('offline'));
  api.getOnboarding.mockResolvedValue({ onboarding: { id: 'o1', dados: { responsavelNome: 'Outra aba' } } });
  montar(api, { onCriado });
  fireEvent.click(screen.getByRole('button', { name: 'Abertura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Virar onboarding' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar preencher a ficha novamente' }));
  await screen.findByText(/Não foi possível conferir a revisão/);
  expect(api.salvarOnboarding).toHaveBeenCalledTimes(1);
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
  expect(onCriado).not.toHaveBeenCalled();
});