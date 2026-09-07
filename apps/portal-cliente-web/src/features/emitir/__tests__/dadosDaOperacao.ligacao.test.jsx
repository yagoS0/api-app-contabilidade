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
