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
import { act, fireEvent, render, screen } from "@testing-library/react";
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
  await act(async () => {});
}

async function submeter() {
  fireEvent.submit(document.querySelector("form"));
  await act(async () => {});
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("⚠ SEM PERFIL — a tela fica exatamente como era", () => {
  test("nenhum seletor de perfil, e os campos de sempre continuam lá", async () => {
    // É o estado de toda empresa até o contador configurar. Esconder campo que ninguém respondeu
    // produziria emissão recusada com o conserto fora da tela.
    comPerfis([]);
    await renderizar();
    expect(seletorPerfil()).not.toBeInTheDocument();
    expect(seletorMunicipio()).toBeInTheDocument();
  });

  test("⚠ a rota fora do ar também não estraga a tela", async () => {
    jest.spyOn(api, "getPerfisDeEmissao").mockRejectedValue(new Error("500"));
    await renderizar();
    expect(seletorPerfil()).not.toBeInTheDocument();
    expect(seletorMunicipio()).toBeInTheDocument();
  });

  test("⚠ e NADA é dito — ausência visível não precisa de legenda", async () => {
    comPerfis([]);
    await renderizar();
    expect(screen.queryByText(/Tipo de serviço/i)).toBeNull();
  });
});

describe("⚠ UM PERFIL — não vira pergunta, e os dois campos somem", () => {
  test("a tela DIZ qual é, e de quem veio", async () => {
    comPerfis([P("pf-1", "Serviços contábeis", true)]);
    await renderizar();
    expect(seletorPerfil()).not.toBeInTheDocument();
    expect(screen.getByText(/"Serviços contábeis"/)).toBeInTheDocument();
    expect(screen.getByText(/seu contador/)).toBeInTheDocument();
  });

  test("⚠⚠ o município da prestação SOME da tela — e do CORPO", async () => {
    comPerfis([P("pf-1", "Serviços contábeis", true)]);
    await renderizar();
    expect(seletorMunicipio()).not.toBeInTheDocument();

    await preencherOMinimo();
    await submeter();
    expect(payloadsEnviados).toHaveLength(1);
    // ⚠ A varredura é do JSON INTEIRO: um teste que só olhasse `corpo.servico.cLocPrestacao`
    // deixaria passar alguém pendurando o campo em outro lugar.
    expect(JSON.stringify(payloadsEnviados[0])).not.toMatch(/cLocPrestacao/);
  });

  test("o código de serviço some da tela", async () => {
    comPerfis([P("pf-1", "Serviços contábeis", true)]);
    await renderizar();
    expect(seletorCodigo()).not.toBeInTheDocument();
    expect(screen.queryByText(/Código de serviço desta nota/i)).toBeNull();
  });

  test("⚠⚠ com UM perfil o `perfilId` NÃO viaja — o servidor resolve sozinho", async () => {
    // Mandar o id aqui não mudaria o resultado e criaria uma segunda fonte para a mesma decisão.
    comPerfis([P("pf-1", "Serviços contábeis", true)]);
    await renderizar();
    await preencherOMinimo();
    await submeter();
    expect(payloadsEnviados[0].perfilId).toBeUndefined();
    expect(JSON.stringify(payloadsEnviados[0])).not.toMatch(/perfilId/);
  });
});

describe("⚠⚠ VÁRIOS PERFIS — a tela recusa em vez de escolher", () => {
  const DOIS = [P("pf-1", "Consultoria"), P("pf-2", "Exportação de serviço", true)];

  test("o seletor aparece SEM pré-seleção, nem pelo padrão", async () => {
    // Cair no `padrao` faria o padrão virar a resposta de quem não respondeu — e os perfis existem
    // porque a empresa tem operações com tributação diferente.
    comPerfis(DOIS);
    await renderizar();
    expect(seletorPerfil()).toBeInTheDocument();
    expect(seletorPerfil().value).toBe("");
  });

  test("⚠⚠ sem escolher, o submit NÃO chega à API", async () => {
    comPerfis(DOIS);
    await renderizar();
    await preencherOMinimo();
    await submeter();
    expect(payloadsEnviados).toHaveLength(0);
    expect(screen.getByText(/Escolha o tipo de serviço/)).toBeInTheDocument();
  });

  test("escolhido, o `perfilId` chega ao payload", async () => {
    comPerfis(DOIS);
    await renderizar();
    fireEvent.change(seletorPerfil(), { target: { value: "pf-2" } });
    await preencherOMinimo();
    await submeter();
    expect(payloadsEnviados).toHaveLength(1);
    expect(payloadsEnviados[0].perfilId).toBe("pf-2");
  });

  test("⚠ o nome é o que o cliente vê — nunca o id nem vocabulário de DPS", async () => {
    comPerfis(DOIS);
    await renderizar();
    expect(screen.getByRole("option", { name: "Exportação de serviço" })).toBeInTheDocument();
    const texto = document.querySelector("form").textContent;
    expect(texto).not.toMatch(/pf-1|pf-2|cTribNac|tribISSQN|regApTribSN/);
  });
});
