import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingDetailPage } from "../../pages/renderOnboardingDetailPage";
import { NovaDemanda } from "../NovaDemanda";
import { ConferirCadastroSalvo } from "../ConferirCadastroSalvo";

test("ficha PF continua na mesma página sem criar empresa ou perder o serviço pessoal", async () => {
  let ficha = { id: "alex", origem: "PESSOA_FISICA", versao: 0, status: "RASCUNHO", ultimoPasso: "revisao", responsavelNome: "Alex", dados: { responsavelNome: "Alex", servicoSolicitado: "Resolver IRRF" }, etapas: [] };
  const api = {
    getOnboarding: jest.fn(async () => ({ onboarding: ficha })),
    salvarOnboarding: jest.fn(async (_, patch) => { ficha = { ...ficha, dados: patch.dados, status: patch.finalizar ? "RECEBIDO" : ficha.status, versao: ficha.versao + 1 }; return { onboarding: ficha }; }),
  };
  const navegar = jest.fn();
  render(<OnboardingDetailPage api={api} onboardingId="alex" preenchimentoInicial onAbrirAtendimento={navegar} />);
  fireEvent.click(await screen.findByRole("button", { name: "Salvar e continuar atendimento" }));
  expect(await screen.findByRole("region", { name: "Dados do cliente" })).toBeVisible();
  expect(ficha.dados.servicoSolicitado).toBe("Resolver IRRF");
  expect(screen.queryByRole("button", { name: "Adicionar à carteira" })).not.toBeInTheDocument();
  expect(navegar).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Dados do cliente" })).toBeVisible();
});

test("nova empresa para Alex usa demanda relacionada e conserva chave no retry", async () => {
  Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: () => "12345678-1234-4234-8234-123456789012" });
  const criar = jest.fn().mockRejectedValueOnce(new Error("Resposta perdida")).mockResolvedValue({ onboarding: { id: "neurogenesis" } });
  const abrir = jest.fn();
  render(<NovaDemanda api={{ criarDemandaOnboarding: criar }} onboarding={{ id: "alex", versao: 4, responsavelNome: "Alex" }} onAbrir={abrir} />);
  fireEvent.click(screen.getByRole("button", { name: "Adicionar empresa ou serviço" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Resposta perdida");
  expect(abrir).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await waitFor(() => expect(abrir).toHaveBeenCalledWith("neurogenesis"));
  expect(criar.mock.calls[0]).toEqual(criar.mock.calls[1]);
  expect(criar).toHaveBeenCalledWith("alex", expect.objectContaining({ origem: "TRANSFERENCIA", versao: 4, chaveSolicitacao: expect.any(String) }));
});

test("sair da edição integrada aguarda salvar e preserva a tela em caso de falha", async () => {
  const ficha = { id: "alex", origem: "PESSOA_FISICA", versao: 0, status: "RASCUNHO", ultimoPasso: "identificacao", dados: { servicoSolicitado: "Resolver IRRF" }, etapas: [] };
  const api = { getOnboarding: jest.fn(async () => ({ onboarding: ficha })), salvarOnboarding: jest.fn().mockRejectedValueOnce(new Error("Sem rede")).mockResolvedValue({ onboarding: ficha }) };
  const voltar = jest.fn();
  render(<OnboardingDetailPage api={api} onboardingId="alex" preenchimentoInicial onVoltar={voltar} />);
  await screen.findByLabelText(/O que precisa resolver/);
  fireEvent.click(screen.getByRole("button", { name: "Entrada de clientes" }));
  await waitFor(() => expect(api.salvarOnboarding).toHaveBeenCalledTimes(1));
  expect(voltar).not.toHaveBeenCalled();
  expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Entrada de clientes" }));
  await waitFor(() => expect(voltar).toHaveBeenCalledTimes(1));
});

test("consulta salva é revisada sem nova requisição nem confirmação automática", () => {
  const acao = jest.fn();
  const onboarding = { cnpj: "11222333000181", versao: 5, dados: { razaoSocial: "Neurogenesis", cadastroCnpj: { cnpj: "11222333000181", consultadoEm: "2026-10-08T12:00:00Z", empresa: { razaoSocial: "Neurogenesis", endereco: { rua: "Rua de teste", numero: "10" }, cnaePrincipal: "1234567" } } } };
  const { rerender } = render(<ConferirCadastroSalvo onboarding={onboarding} acao={acao} />);
  expect(screen.getByText("Rua de teste, 10")).toBeVisible();
  expect(acao).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferi os dados: continuar" }));
  expect(acao).toHaveBeenCalledWith("/jornada/conferencia", expect.objectContaining({ versao: 5, tipo: "PUBLICA", manual: expect.objectContaining({ fonte: expect.any(String) }) }));
  rerender(<ConferirCadastroSalvo onboarding={{ ...onboarding, cnpj: "outro" }} acao={acao} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
