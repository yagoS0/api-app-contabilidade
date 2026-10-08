import { ConversaoModal } from "../ConversaoModal";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormularioPublico } from "../../pages/FormularioPublico";
import { OnboardingWizardPage } from "../../pages/renderOnboardingWizardPage";
import { useConsultaCnpjOnboarding } from "../../hooks/useConsultaCnpjOnboarding";
import { consultarCnpj } from "../../lib/brasilApi";
import { podarInvisiveis } from "../../lib/onboardingSpec";
import { prepararConversao } from "../../lib/conversaoEmpresa";
jest.mock("../../lib/brasilApi", () => ({ ...jest.requireActual("../../lib/brasilApi"), consultarCnpj: jest.fn() }));
const documento = "11222333000181";
const retorno = { ok: true, empresa: { razaoSocial: "EMPRESA TESTE", nomeFantasia: "TESTE" }, bruto: { razao_social: "EMPRESA TESTE", nome_fantasia: "TESTE", logradouro: "Rua Teste", numero: "10", bairro: "Centro", municipio: "Teste", uf: "SP", cep: "01001000", cnae_fiscal: 6201501 }, situacao: { texto: "ATIVA", ativa: true } };
beforeEach(() => { consultarCnpj.mockReset(); consultarCnpj.mockResolvedValue(retorno); });
function apiPara(origem = "TRANSFERENCIA", dados = {}) {
  const onboarding = { id: "teste", origem, dados, ultimoPasso: "identificacao", versao: 0 };
  return { getOnboarding: jest.fn().mockResolvedValue({ onboarding }), consultarFormularioOnboarding: jest.fn().mockResolvedValue({ onboarding }), salvarOnboarding: jest.fn().mockImplementation(async (_id, p) => ({ onboarding: { ...onboarding, ...p, versao: p.versao + 1 } })), salvarFormularioOnboarding: jest.fn().mockImplementation(async (_id, p) => ({ onboarding: { ...onboarding, ...p, versao: p.versao + 1 } })) };
}
test("link consulta ao digitar, salva cadastro completo e conversão reaproveita endereço sem repetir consulta", async () => {
  window.history.replaceState(null, "", "/onboarding/publico#token=teste");
  const api = apiPara(); render(<FormularioPublico api={api} />);
  fireEvent.change(await screen.findByLabelText(/^CNPJ/), { target: { value: documento } });
  await waitFor(() => expect(screen.getByLabelText(/^Razão social/)).toHaveValue("EMPRESA TESTE"));
  fireEvent.click(screen.getByText("Salvar e continuar"));
  await waitFor(() => expect(api.salvarFormularioOnboarding).toHaveBeenCalled());
  const dados = api.salvarFormularioOnboarding.mock.calls[0][1].dados;
  expect(dados.cadastroCnpj.empresa.endereco).toMatchObject({ rua: "Rua Teste", numero: "10" });
  expect(prepararConversao({ cnpj: documento, dados }).endereco.rua).toBe("Rua Teste");
  expect(prepararConversao({ cnpj: "outra", dados }).endereco.rua).toBe("");
  expect(consultarCnpj).toHaveBeenCalledTimes(1);
  expect(podarInvisiveis("TRANSFERENCIA", { ...dados, cnpj: "outro" }).cadastroCnpj).toBeUndefined();
  expect(podarInvisiveis("PESSOA_FISICA", dados).cadastroCnpj).toBeUndefined();
});
test("wizard interno preenche automaticamente e falha permite edição e repetição", async () => {
  consultarCnpj.mockResolvedValueOnce({ ok: false, mensagem: "Falha de rede" });
  render(<OnboardingWizardPage api={apiPara()} onboardingId="teste" embedded />);
  fireEvent.change(await screen.findByLabelText(/^CNPJ/), { target: { value: documento } });
  await screen.findByText(/Falha de rede/);
  fireEvent.change(screen.getByLabelText(/^Razão social/), { target: { value: "Nome manual" } });
  fireEvent.click(screen.getByText("Consultar novamente"));
  await screen.findByText(/Dados preenchidos pela consulta/);
  expect(screen.getByLabelText(/^Razão social/)).toHaveValue("Nome manual");
  expect(consultarCnpj).toHaveBeenCalledTimes(2);
});
function Corrida() {
  const [dados, setDados] = useState({ cnpj: "", razaoSocial: "" });
  const c = useConsultaCnpjOnboarding({ contexto: "a", origem: "TRANSFERENCIA", dados, alterarCampo: (k, v) => setDados(d => ({ ...d, [k]: v })) });
  return <><input aria-label="Documento" value={dados.cnpj} onChange={e => c.editar("cnpj", e.target.value)} /><input aria-label="Nome" value={dados.razaoSocial} onChange={e => c.editar("razaoSocial", e.target.value)} /><output>{JSON.stringify(dados)}</output></>;
}
test("resposta atrasada não mistura empresas e correção durante consulta vence", async () => {
  let resolver; consultarCnpj.mockImplementationOnce(() => new Promise(r => { resolver = r; }));
  render(<Corrida />); fireEvent.change(screen.getByLabelText("Documento"), { target: { value: documento } });
  await waitFor(() => expect(consultarCnpj).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Documento"), { target: { value: "123" } });
  await act(async () => resolver(retorno));
  expect(screen.getByLabelText("Nome")).toHaveValue("");
  expect(JSON.parse(screen.getByRole("status").textContent).cadastroCnpj).toBeNull();
  consultarCnpj.mockImplementationOnce(() => new Promise(r => { resolver = r; }));
  fireEvent.change(screen.getByLabelText("Documento"), { target: { value: documento } });
  await waitFor(() => expect(consultarCnpj).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Correção" } });
  await act(async () => resolver(retorno));
  expect(screen.getByLabelText("Nome")).toHaveValue("Correção");
});
test("snapshot salvo evita consulta ao reabrir e CNPJ incompleto não consulta", async () => {
  const api = apiPara("TRANSFERENCIA", { cnpj: documento, cadastroCnpj: { cnpj: documento, empresa: {} } });
  render(<OnboardingWizardPage api={api} onboardingId="teste" embedded />);
  await screen.findByLabelText(/^CNPJ/);
  await act(async () => new Promise(r => setTimeout(r, 600)));
  expect(consultarCnpj).not.toHaveBeenCalled();
});

test("clique antes do debounce faz só uma consulta e poda não aceita metadados de aprovação", async () => {
  render(<OnboardingWizardPage api={apiPara()} onboardingId="teste" embedded />);
  fireEvent.change(await screen.findByLabelText(/^CNPJ/), { target: { value: documento } });
  fireEvent.click(screen.getByText("Consultar novamente"));
  await screen.findByText(/Dados preenchidos pela consulta/);
  await act(async () => new Promise(r => setTimeout(r, 600)));
  expect(consultarCnpj).toHaveBeenCalledTimes(1);
  const dados = podarInvisiveis("TRANSFERENCIA", { cnpj: documento, cadastroCnpj: { cnpj: documento, fonte: "BRASIL_API", consultadoEm: new Date().toISOString(), empresa: { razaoSocial: "Teste", segredo: "remover" }, aprovado: true } });
  expect(dados.cadastroCnpj.aprovado).toBeUndefined();
  expect(dados.cadastroCnpj.empresa.segredo).toBeUndefined();
});

test("conversão protege correções em andamento e descarta resposta de outro CNPJ", async () => {
  let resolver; consultarCnpj.mockImplementation(() => new Promise(r => { resolver = r; }));
  render(<ConversaoModal onboarding={{ id: "teste", cnpj: documento, razaoSocial: "Salvo", dados: {} }} onFechar={() => {}} />);
  fireEvent.click(screen.getByText("consultar Receita"));
  fireEvent.change(screen.getByLabelText(/^Razão social/), { target: { value: "Nome corrigido" } });
  fireEvent.change(screen.getByLabelText(/^Rua/), { target: { value: "Rua corrigida" } });
  await act(async () => resolver(retorno));
  expect(screen.getByLabelText(/^Razão social/)).toHaveValue("Nome corrigido");
  expect(screen.getByLabelText(/^Rua/)).toHaveValue("Rua corrigida");
  expect(screen.getByLabelText(/^CNAE principal/)).toHaveValue("6201501");
  fireEvent.click(screen.getByText("consultar Receita"));
  fireEvent.change(screen.getByLabelText(/^CNPJ definitivo/), { target: { value: "123" } });
  await act(async () => resolver(retorno));
  expect(screen.getByLabelText(/^Razão social/)).toHaveValue("");
  expect(screen.getByLabelText(/^Rua/)).toHaveValue("");
  expect(screen.getByLabelText(/^CNAE principal/)).toHaveValue("");
});

test("primeiro CNPJ da abertura preserva dados planejados antes de consultar", () => {
  render(<ConversaoModal onboarding={{ id: "abertura", razaoSocial: "Nome planejado", dados: { capitalSocialPretendido: 1000, socios: [{ nome: "Ana", cpf: "", participacao: "100" }] } }} onFechar={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^CNPJ definitivo/), { target: { value: documento } });
  expect(screen.getByLabelText(/^Razão social/)).toHaveValue("Nome planejado");
  expect(screen.getByLabelText("Nome do sócio 1")).toHaveValue("Ana");
  expect(consultarCnpj).not.toHaveBeenCalled();
});
