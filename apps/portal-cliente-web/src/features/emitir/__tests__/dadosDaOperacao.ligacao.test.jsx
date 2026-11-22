// O PERFIL DE EMISSÃO NA TELA DO CLIENTE — a corrente, e o que ela tira do PAYLOAD.
//
// ⚠⚠ A REGRA JÁ TEM SUÍTE PRÓPRIA (`lib/__tests__/perfilDaNota.test.js`, 23 casos). O que este
// arquivo prova é o elo que nenhum teste de regra alcança: **o que sai no corpo**. Campo escondido
// que continua viajando é o defeito pior — e aqui isso é medido varrendo o `JSON.stringify` do
// payload inteiro, não só a chave que se espera.
//
// ⚠⚠ NADA É EMITIDO: `api.emitirNfse` é um espião que REGISTRA e recusa pela camada NOSSA, e o
// `fetch` global explode se alguém encostar nele.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { api } from "../../../api";
import { EmitirNotaPage } from "../EmitirNotaPage";

const EMPRESA = {
  companyId: "pc-001",
  razao: "ACME SERVICOS LTDA",
  cnpj: "11222333000181",
  myRole: "OWNER",
  emissaoNfseLiberada: true,
  legacyCompany: {
    regimeTributario: "SIMPLES_NACIONAL",
    inscricaoMunicipal: "1234567",
    codigoServicoNacional: "010101",
    codigosServicoNacional: [],
    codigoServicoMunicipal: "1.01",
    rpsSerie: "1",
  },
};

const P = (id, nome, padrao = false) => ({ id, nome, padrao });

let fetchOriginal;
let payloadsEnviados;

function comPerfis(perfis) {
  jest.spyOn(api, "getPerfisDeEmissao").mockResolvedValue({ data: perfis, total: perfis.length });
}

beforeEach(() => {
  window.localStorage.clear();
  payloadsEnviados = [];
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => { throw new Error("nenhum teste desta suíte pode tocar a rede"); });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "getTomadoresEmitidos").mockResolvedValue([]);
  jest.spyOn(api, "consultarCnpj").mockResolvedValue({
    ok: false, motivo: "nao_encontrado", mensagem: "CNPJ não encontrado.",
  });
  jest.spyOn(api, "emitirNfse").mockImplementation(async (_companyId, payload) => {
    payloadsEnviados.push(payload);
    const err = new Error("recusa simulada");
    err.status = 400;
    err.code = "nfse_falha_local";
    err.corpo = { camada: "NOSSA", codigo: "SIMULADO" };
    throw err;
  });
});

afterEach(() => {
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

async function renderizar() {
  const r = render(
    <StrictMode>
      <EmitirNotaPage empresa={EMPRESA} aoVoltarParaNotas={() => {}} aoRecarregarEmpresas={() => {}} />
    </StrictMode>
  );
  await act(async () => {});
  return r;
}

const seletorPerfil = () => document.getElementById("emitir-perfil");
const seletorCodigo = () => document.getElementById("emitir-codigo-servico");
const seletorMunicipio = () => document.getElementById("emitir-loc-prestacao");

async function preencherOMinimo() {
  const set = (id, valor) => fireEvent.change(document.getElementById(id), { target: { value: valor } });
  set("emitir-doc", "44555666000177");
  set("emitir-nome", "TOMADOR EXEMPLO LTDA");
  set("emitir-cep", "01001000");
  set("emitir-logradouro", "RUA X");
  set("emitir-numero", "10");
  set("emitir-bairro", "CENTRO");
  set("emitir-descricao", "Servico de teste");
  set("emitir-valor", "1.000,00");
  // ⚠ A EMPRESA DESTA SUÍTE É DO SIMPLES, e desde 31/08/2026 a tela CONFERE o `pTotTribSN`
  // antes de enviar (`conferirPTotTribSN`) — o servidor o exige (`MISSING_P_TOT_TRIB_SN`), e a
  // guarda existe para o cliente não descobrir isso depois de preencher a nota inteira.
  // Aqui o VALOR não importa: o assunto deste arquivo é o perfil. O que importa é o submit
  // chegar à API — sem isto, as asserções sobre o CORPO comparam `undefined` com `undefined`
  // e passariam por engano no dia em que a guarda saísse.
  const aliquota = document.getElementById("emitir-ptottribsn");
  if (aliquota) fireEvent.change(aliquota, { target: { value: "6" } });
  await act(async () => {});
}

async function submeter() {
  fireEvent.submit(document.querySelector("form"));
  await act(async () => {});
}

test("envio trava retorno e duplicata, comunica a casca e conserva o desfecho", async () => {
  comPerfis([]);
  let concluir;
  api.emitirNfse.mockImplementation(() => new Promise(resolve => { concluir = resolve; }));
  const aoMudarEnvio = jest.fn(), aoVoltarParaNotas = jest.fn();
  render(<EmitirNotaPage empresa={EMPRESA} aoMudarEnvio={aoMudarEnvio} aoVoltarParaNotas={aoVoltarParaNotas} />);
  await act(async () => {});
  await preencherOMinimo();
  await submeter(); await submeter();
  expect(api.emitirNfse).toHaveBeenCalledTimes(1);
  expect(aoMudarEnvio).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("button", { name: /Voltar para as notas/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Voltar para as notas/ }));
  expect(aoVoltarParaNotas).not.toHaveBeenCalled();
  await act(async () => concluir({ status: "issued", nfse: { numero: "123", chaveAcesso: "CHAVE" } }));
  expect(aoMudarEnvio).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("heading", { name: /Nota .* emitida/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Voltar para as notas/ })).toBeEnabled();
});


const preencherOperacao = () => {
  for (const [id, value] of Object.entries({vRetIRRF:"10,50",vRetCP:"20",obraCodigo:"123456",obraInscricao:"987",destinatarioDoc:"11222333000181",destinatarioNome:"DESTINATARIO LTDA"}))
    fireEvent.change(document.getElementById("emitir-"+id),{target:{value}});
};
test("os dados da operação aparecem na prévia e viajam no corpo da emissão",async()=>{
  comPerfis([]);await renderizar();await preencherOMinimo();preencherOperacao();
  const previa=within(screen.getByLabelText("Pré-visualização da nota"));
  expect(previa.getByText("DESTINATARIO LTDA")).toBeInTheDocument();
  expect(previa.getByText(/CNO\/CEI: 123456/)).toBeInTheDocument();
  expect(previa.getByText(/969,50/)).toBeInTheDocument();
  await submeter();
  expect(payloadsEnviados).toHaveLength(1);
  expect(payloadsEnviados[0]).toMatchObject({retencoesComplementares:{vRetIRRF:"10.50",vRetCP:"20.00"},obra:{cObra:"123456",inscImobFisc:"987"},destinatario:{cnpjCpf:"11222333000181",nome:"DESTINATARIO LTDA"}});
});
test("retenção inválida impede o envio mesmo por submit direto",async()=>{
  comPerfis([]);await renderizar();await preencherOMinimo();
  fireEvent.change(document.getElementById("emitir-vRetIRRF"),{target:{value:"1000"}});
  await submeter();expect(payloadsEnviados).toHaveLength(0);
  expect(document.getElementById("emitir-operacao-erro")).toHaveFocus();
});
test("trocar de empresa limpa os dados específicos",async()=>{
  comPerfis([]);const r=await renderizar();preencherOperacao();
  r.rerender(<StrictMode><EmitirNotaPage empresa={{...EMPRESA,companyId:"outra"}} aoVoltarParaNotas={()=>{}} aoRecarregarEmpresas={()=>{}} /></StrictMode>);
  await act(async()=>{});
  for(const campo of ["vRetIRRF","vRetCP","obraCodigo","obraInscricao","destinatarioDoc","destinatarioNome"])
    expect(document.getElementById("emitir-"+campo)).toHaveValue("");
});

test("usar outra nota como modelo não reaproveita retenções ou dados especiais",async()=>{
  comPerfis([]);const r=await renderizar();preencherOperacao();
  const modelo={companyId:EMPRESA.companyId,campos:{descricao:"Modelo",vRetIRRF:"99"},avisos:[],origem:{numero:"123"}};
  r.rerender(<StrictMode><EmitirNotaPage empresa={EMPRESA} modelo={modelo} aoVoltarParaNotas={()=>{}} aoRecarregarEmpresas={()=>{}} /></StrictMode>);
  await act(async()=>{});
  for(const campo of ["vRetIRRF","vRetCP","obraCodigo","obraInscricao","destinatarioDoc","destinatarioNome"])
    expect(document.getElementById("emitir-"+campo)).toHaveValue("");
});

const preencherEnderecoObra = () => {
  fireEvent.change(document.getElementById("emitir-obraTipo"), { target: { value: "end" } });
  for (const [k, value] of Object.entries({ CEP: "01551-020", xLgr: "Rua da obra", nro: "0", xCpl: "Bloco A", xBairro: "Centro" }))
    fireEvent.change(document.getElementById(`emitir-obra${k}`), { target: { value } });
};
test("endereço da obra aparece na prévia e no payload sem reutilizar tomador", async () => {
  comPerfis([]); await renderizar(); await preencherOMinimo(); preencherOperacao(); preencherEnderecoObra();
  expect(screen.getByText(/o CEP da obra deve pertencer ao município da prestação/)).toBeInTheDocument();
  expect(within(screen.getByLabelText("Pré-visualização da nota")).getByText("Inscrição imobiliária: 987")).toBeInTheDocument();
  expect(within(screen.getByLabelText("Pré-visualização da nota")).getByText(/Rua da obra · 0 · Bloco A · Centro · CEP 01551020/)).toBeInTheDocument();
  await submeter();
  expect(payloadsEnviados).toHaveLength(1);
  expect(payloadsEnviados[0].obra).toEqual({ inscImobFisc: "987", end: { CEP: "01551020", xLgr: "Rua da obra", nro: "0", xCpl: "Bloco A", xBairro: "Centro" } });
  expect(payloadsEnviados[0].tomador.endereco.xLgr).toBe("RUA X");
});
test("trocar tipo limpa endereço e identificadores; trocar empresa limpa a alternativa", async () => {
  comPerfis([]); const r = await renderizar(); preencherOperacao(); preencherEnderecoObra();
  fireEvent.change(document.getElementById("emitir-obraTipo"), { target: { value: "cCIB" } });
  expect(document.getElementById("emitir-obraCodigo")).toHaveValue("");
  expect(document.getElementById("emitir-obraInscricao")).toHaveValue("987");
  fireEvent.change(document.getElementById("emitir-obraTipo"), { target: { value: "end" } });
  expect(document.getElementById("emitir-obraCEP")).toHaveValue("");
  preencherEnderecoObra();
  r.rerender(<StrictMode><EmitirNotaPage empresa={{ ...EMPRESA, companyId: "outra" }} /></StrictMode>);
  await act(async () => {});
  expect(document.getElementById("emitir-obraTipo")).toHaveValue("cObra");
  fireEvent.change(document.getElementById("emitir-obraTipo"), { target: { value: "end" } });
  expect(document.getElementById("emitir-obraCEP")).toHaveValue("");
});

test("endereço incompleto impede submit e apagar tudo limpa a obra", async () => {
  comPerfis([]);
  const modelo = { companyId: EMPRESA.companyId, campos: { descricao: "Modelo" }, avisos: [], origem: { numero: "123" } };
  render(<StrictMode><EmitirNotaPage empresa={EMPRESA} modelo={modelo} aoDescartarModelo={() => {}} /></StrictMode>);
  await act(async () => {}); await preencherOMinimo();
  fireEvent.change(document.getElementById("emitir-obraTipo"), { target: { value: "end" } });
  await submeter();
  expect(payloadsEnviados).toHaveLength(0);
  expect(document.getElementById("emitir-operacao-erro")).toHaveFocus();
  preencherEnderecoObra();
  fireEvent.click(screen.getByRole("button", { name: "Apagar tudo" }));
  expect(document.getElementById("emitir-obraTipo")).toHaveValue("cObra");
  fireEvent.change(document.getElementById("emitir-obraTipo"), { target: { value: "end" } });
  expect(document.getElementById("emitir-obraCEP")).toHaveValue("");
});
