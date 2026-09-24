import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { EmitirNotaPage } from "../EmitirNotaPage";

const EMPRESA = { companyId: "pc-001", razao: "ACME SERVICOS LTDA", cnpj: "11222333000181", myRole: "OWNER", emissaoNfseLiberada: true,
  legacyCompany: { regimeTributario: "SIMPLES_NACIONAL", inscricaoMunicipal: "1234567", codigoServicoNacional: "010101", codigoServicoMunicipal: "1.01", rpsSerie: "1" } };
const CEP = { ok: true, endereco: { cMun: "3550308", xLgr: "Praça da Sé", xBairro: "Sé" } };
const CNPJ = { ok: true, situacao: { texto: "ATIVA", ativa: true }, bruto: { razao_social: "Tomador consultado", municipio: "SAO PAULO", uf: "SP", codigo_municipio_ibge: "3550308", logradouro: "Rua consultada", numero: "100", bairro: "Centro", cep: "01001000" } };
let fetchOriginal;
beforeEach(() => {
  window.localStorage.clear();
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => { throw new Error("rede proibida neste teste"); });
  jest.spyOn(api, "getPerfisDeEmissao").mockResolvedValue({ habilitado: false, data: [], total: 0 });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "consultarCnpj").mockResolvedValue({ ok: false, motivo: "nao_encontrado", mensagem: "CNPJ não encontrado na base da Receita." });
  jest.spyOn(api, "consultarCep").mockResolvedValue(CEP);
  jest.spyOn(api, "emitirNfse").mockImplementation(() => { throw new Error("emissão proibida neste teste"); });
});
afterEach(() => {
  expect(global.fetch).not.toHaveBeenCalled();
  expect(api.emitirNfse).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});
const campo = id => document.getElementById(`emitir-${id}`);
const digitar = (id, value) => fireEvent.change(campo(id), { target: { value } });
async function abrir(modelo = null) {
  render(<StrictMode><EmitirNotaPage empresa={EMPRESA} modelo={modelo} aoVoltarParaNotas={() => {}} aoRecarregarEmpresas={() => {}} /></StrictMode>);
  await act(async () => {});
}
async function cnpjNaoEncontrado() {
  digitar("doc", "11222333000181");
  await screen.findByText("CNPJ não encontrado na base da Receita.");
}
function pendente() { let resolver; const promessa = new Promise(r => { resolver = r; }); return { promessa, resolver }; }

test("em StrictMode, CEP preenche endereço após falha do CNPJ e mantém número digitado", async () => {
  await abrir(); await cnpjNaoEncontrado();
  digitar("numero", "27"); digitar("cep", "01001-000");
  await waitFor(() => expect(campo("logradouro")).toHaveValue("Praça da Sé"));
  expect(campo("bairro")).toHaveValue("Sé");
  expect(campo("numero")).toHaveValue("27");
  expect(api.consultarCep).toHaveBeenCalledWith("01001000");
  expect(api.consultarCnpj).toHaveBeenCalledTimes(1);
});

test("edição manual durante consulta CEP prevalece sem impedir preenchimento dos outros campos", async () => {
  const pedido = pendente(); api.consultarCep.mockReturnValue(pedido.promessa);
  await abrir(); await cnpjNaoEncontrado(); digitar("cep", "01001000");
  await waitFor(() => expect(api.consultarCep).toHaveBeenCalledTimes(1));
  digitar("logradouro", "Rua digitada pelo cliente"); digitar("numero", "51");
  await act(async () => pedido.resolver(CEP));
  expect(campo("logradouro")).toHaveValue("Rua digitada pelo cliente");
  expect(campo("bairro")).toHaveValue("Sé");
  expect(campo("numero")).toHaveValue("51");
});

test("resposta CEP pendente é descartada ao trocar documento do tomador", async () => {
  const pedido = pendente(); api.consultarCep.mockReturnValue(pedido.promessa);
  await abrir(); await cnpjNaoEncontrado(); digitar("cep", "01001000");
  await waitFor(() => expect(api.consultarCep).toHaveBeenCalledTimes(1));
  digitar("doc", "52998224725");
  await act(async () => pedido.resolver(CEP));
  expect(campo("logradouro")).not.toHaveValue("Praça da Sé");
  expect(campo("bairro")).not.toHaveValue("Sé");
});

test("exceção na consulta CNPJ vira erro recuperável e botão repete a consulta", async () => {
  api.consultarCnpj.mockRejectedValueOnce(new Error("rede indisponível")).mockResolvedValueOnce(CNPJ);
  await abrir(); digitar("doc", "11222333000181");
  await screen.findByText(/Não foi possível consultar o CNPJ/);
  fireEvent.click(screen.getByRole("button", { name: "Consultar de novo" }));
  await waitFor(() => expect(campo("nome")).toHaveValue("Tomador consultado"));
  expect(api.consultarCnpj).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/Não foi possível consultar o CNPJ/)).not.toBeInTheDocument();
});

test("exceção CEP permite retentativa sem perder endereço manual", async () => {
  api.consultarCep.mockRejectedValueOnce(new Error("serviço indisponível")).mockResolvedValueOnce(CEP);
  await abrir(); await cnpjNaoEncontrado(); digitar("cep", "01001000");
  await screen.findByRole("button", { name: "Consultar CEP novamente" });
  digitar("numero", "88");
  fireEvent.click(screen.getByRole("button", { name: "Consultar CEP novamente" }));
  await waitFor(() => expect(campo("logradouro")).toHaveValue("Praça da Sé"));
  expect(campo("numero")).toHaveValue("88");
  expect(api.consultarCep).toHaveBeenCalledTimes(2);
});

test("trocar CEP limpa endereço anterior antes da resposta e preserva número/complemento", async () => {
  await abrir(); await cnpjNaoEncontrado(); digitar("cep", "01001000");
  await waitFor(() => expect(campo("logradouro")).toHaveValue("Praça da Sé"));
  digitar("numero", "21"); digitar("complemento", "Sala 3");
  const pedido = pendente(); api.consultarCep.mockReturnValueOnce(pedido.promessa);
  digitar("cep", "30140071");
  await waitFor(() => expect(api.consultarCep).toHaveBeenCalledWith("30140071"));
  expect(campo("logradouro")).toHaveValue("");
  expect(campo("bairro")).toHaveValue("");
  expect(campo("numero")).toHaveValue("21");
  expect(campo("complemento")).toHaveValue("Sala 3");
  await act(async () => pedido.resolver({ ok: false, mensagem: "CEP indisponível" }));
  expect(campo("logradouro")).toHaveValue("");
  expect(campo("bairro")).toHaveValue("");
});

test("trocar documento remove endereço automático do CEP, mas mantém campo editado manualmente", async () => {
  await abrir(); await cnpjNaoEncontrado(); digitar("cep", "01001000");
  await waitFor(() => expect(campo("logradouro")).toHaveValue("Praça da Sé"));
  digitar("logradouro", "Endereço corrigido pelo cliente");
  digitar("doc", "52998224725");
  await waitFor(() => expect(campo("bairro")).toHaveValue(""));
  expect(campo("logradouro")).toHaveValue("Endereço corrigido pelo cliente");
});

test("modelo com endereço parcial compatível recebe lacunas do CNPJ sem perder número/complemento", async () => {
  api.consultarCnpj.mockResolvedValue(CNPJ);
  const modelo = { companyId: EMPRESA.companyId, campos: { tomadorDoc: "11222333000181", tomadorNome: "Nome da nota anterior", cep: "01001000", numero: "27", complemento: "Sala do modelo" }, avisos: [], origem: { numero: "321" } };
  await abrir(modelo);
  await waitFor(() => expect(campo("logradouro")).toHaveValue("Rua consultada"));
  expect(campo("bairro")).toHaveValue("Centro");
  expect(campo("numero")).toHaveValue("27");
  expect(campo("complemento")).toHaveValue("Sala do modelo");
  expect(campo("nome")).toHaveValue("Nome da nota anterior");
});
