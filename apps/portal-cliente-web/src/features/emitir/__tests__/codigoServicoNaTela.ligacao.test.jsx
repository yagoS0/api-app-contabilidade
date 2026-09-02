// O CÓDIGO DE SERVIÇO NA TELA — os três ramos, e a prova de que a escolha CHEGA AO PAYLOAD.
//
// ⚠⚠ A REGRA JÁ TEM SUÍTE PRÓPRIA (`lib/__tests__/codigoServicoDaNota.test.js`, 30 casos, com o
// amarre contra a autoridade do backend). O que este arquivo prova é a CORRENTE — e ela tem um elo
// que nenhum teste de regra alcança: **o que sai no payload**. Um seletor que parece funcionar e
// emite outro código é erro fiscal SILENCIOSO, e é exatamente isso que se mede aqui.
//
// ⚠ **0 DE 33 EMPRESAS EM PRODUÇÃO TÊM LISTA PLURAL.** O ramo `UNICO` é o que de fato renderiza
// hoje; o do seletor é o caminho futuro. Os dois são medidos, e o mock exercita os dois.
//
// ⚠⚠ NADA É EMITIDO. `api.emitirNfse` é um espião que REGISTRA o payload e devolve uma falha da
// camada NOSSA — nenhuma chamada sai da máquina (a camada de API inteira é simulada, e o `fetch`
// global explode).

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { EmitirNotaPage } from "../EmitirNotaPage";

const EMPRESA_BASE = {
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

function empresaCom(patch) {
  return { ...EMPRESA_BASE, legacyCompany: { ...EMPRESA_BASE.legacyCompany, ...patch } };
}

let fetchOriginal;
let payloadsEnviados;

beforeEach(() => {
  window.localStorage.clear();
  payloadsEnviados = [];
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "consultarCnpj").mockResolvedValue({
    ok: false, motivo: "nao_encontrado", mensagem: "CNPJ não encontrado.",
  });
  // ⚠ REGISTRA E RECUSA. A recusa é da camada NOSSA (nada sai da máquina, nem no mundo real), e é
  // ela que mantém o teste honesto: nenhum caso simula uma emissão bem-sucedida.
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

async function renderizar(empresa = EMPRESA_BASE) {
  const r = render(
    <StrictMode>
      <EmitirNotaPage empresa={empresa} aoVoltarParaNotas={() => {}} aoRecarregarEmpresas={() => {}} />
    </StrictMode>
  );
  await act(async () => {});
  return r;
}

const seletor = () => document.getElementById("emitir-codigo-servico");

/** Preenche o mínimo para o formulário poder ser submetido. */
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
  // ⚠⚠ A ALÍQUOTA EFETIVA ENTROU AQUI EM 31/08/2026, e o motivo vale ser lido: esta suíte mocka
  // `getAliquotas` como `[]` numa empresa do SIMPLES, então o campo ficava VAZIO — e o payload que
  // ela media era um que `NfseService.js:626` recusaria com `MISSING_P_TOT_TRIB_SN`. O submit
  // passava porque a tela não conferia; hoje `conferirPTotTribSN` recusa antes, como o servidor.
  // ⚠ Não é o assunto desta suíte (que mede o CÓDIGO DE SERVIÇO no payload): é o mínimo que uma
  // pessoa real teria de preencher para chegar ao clique de emitir.
  set("emitir-ptottribsn", "6.24");
  await act(async () => {});
}

async function submeter() {
  fireEvent.submit(document.querySelector("form"));
  await act(async () => {});
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ TETO DE TEMPO DESTE ARQUIVO — 20 s, e ele é DAQUI, nunca do `jest.config` (02/09/2026).
 *
 * ⚠⚠ **O PADRÃO DE 5 s NÃO SOBE NA CONFIGURAÇÃO**, e a razão é concreta: foi ele que expôs, em
 * 01/09/2026, uma rota que PENDURAVA (a varredura de notas consultando o banco sem dublê). Um teto
 * global maior teria transformado aquele defeito em *"a suíte está lenta hoje"* — que é exatamente
 * como esta flutuação foi lida por semanas.
 *
 * ⚠⚠ **A MEDIÇÃO QUE JUSTIFICA O NÚMERO** (`jest --json`, 1.434 casos deste app): **17 casos** levam
 * 3 s ou mais, e eles se concentram em **5 arquivos** — este é um deles. O mais pesado marcou
 * 6,3 s. Ou seja: o corte de 5 s cai NO MEIO de uma população densa, e quem estoura não é o teste
 * errado — é o que estava rodando quando a máquina engasgou. Subir teste a teste seria correr atrás
 * de um alvo que muda a cada execução.
 *
 * ⚠ O custo é jsdom montando tabela de verdade (dezenas de células com estilo próprio, várias
 * renderizações por caso). Não há espera, relógio nem rede aqui — em navegador isto é instantâneo.
 * ⚠ Os outros ~1.417 casos deste app continuam com os 5 s de sempre.
 */
jest.setTimeout(20000);

describe("⚠ UM CÓDIGO SÓ — o ramo que RENDERIZA HOJE (0 de 33 empresas têm lista plural)", () => {
  test("não pergunta nada: diz qual código vai, sem seletor", async () => {
    await renderizar();
    expect(seletor()).not.toBeInTheDocument();
    expect(screen.getByText(/Código de serviço desta nota/i)).toBeInTheDocument();
    expect(screen.getByText("010101")).toBeInTheDocument();
  });

  test("⚠⚠ e NÃO manda o campo no payload — sem ele, o servidor usa o cadastro, como sempre usou", async () => {
    await renderizar();
    await preencherOMinimo();
    await submeter();
    await waitFor(() => expect(payloadsEnviados).toHaveLength(1));
    // Nenhuma emissão existente pode mudar de comportamento por esta entrega.
    expect(payloadsEnviados[0].servico).not.toHaveProperty("codigoServicoNacional");
  });

  test("a descrição oficial dos 335 chega junto do número (import dinâmico)", async () => {
    await renderizar();
    await waitFor(() =>
      expect(screen.getByText(/Análise e desenvolvimento de sistemas/i)).toBeInTheDocument()
    );
  });
});

describe("⚠ VÁRIOS CÓDIGOS — o seletor, inalcançável em produção hoje", () => {
  const COM_LISTA = empresaCom({ codigosServicoNacional: ["070201", "140201"] });

  test("o seletor aparece, com os códigos do CADASTRO — e a lista vence o singular", async () => {
    await renderizar(COM_LISTA);
    const opcoes = [...seletor().options].map((o) => o.value);
    expect(opcoes).toEqual(["", "070201", "140201"]);
    // ⚠ O singular (010101) NÃO é oferecido: a lista é a autoridade quando existe.
    expect(opcoes).not.toContain("010101");
  });

  test("⚠⚠ NADA vem pré-selecionado — 'o primeiro da lista' seria o sistema declarando ao fisco", async () => {
    await renderizar(COM_LISTA);
    expect(seletor().value).toBe("");
    expect(screen.getByText(/Escolha o código de serviço desta nota/i)).toBeInTheDocument();
  });

  test("⚠⚠ sem escolher, NADA é enviado — senão o servidor cairia no singular EM SILÊNCIO", async () => {
    await renderizar(COM_LISTA);
    await preencherOMinimo();
    await submeter();
    // Esta é a trava mais cara do arquivo: a empresa habilitou DOIS serviços, e emitir sob o
    // singular sem ninguém ter escolhido é o erro fiscal silencioso.
    expect(payloadsEnviados).toHaveLength(0);
    expect(api.emitirNfse).not.toHaveBeenCalled();
  });

  test("⚠⚠ escolhido, o CÓDIGO ESCOLHIDO é o que chega ao payload", async () => {
    await renderizar(COM_LISTA);
    await preencherOMinimo();
    fireEvent.change(seletor(), { target: { value: "140201" } });
    await act(async () => {});
    await submeter();
    await waitFor(() => expect(payloadsEnviados).toHaveLength(1));
    // ⚠ O OPOSTO do caso da carga tributária, onde a tela mostra e não manda: aqui a escolha é
    // DA NOTA, e um seletor que não chega ao XML seria enfeite.
    expect(payloadsEnviados[0].servico.codigoServicoNacional).toBe("140201");
    // E não o singular do cadastro.
    expect(payloadsEnviados[0].servico.codigoServicoNacional).not.toBe("010101");
  });

  test("⚠ trocar o código NÃO reescreve a descrição que a pessoa editou", async () => {
    await renderizar(COM_LISTA);
    await preencherOMinimo();
    fireEvent.change(document.getElementById("emitir-descricao"), {
      target: { value: "MINHA DESCRICAO PROPRIA" },
    });
    await act(async () => {});
    fireEvent.change(seletor(), { target: { value: "140201" } });
    await act(async () => {});
    // O digitado vence, como em toda parte deste app.
    expect(document.getElementById("emitir-descricao").value).toBe("MINHA DESCRICAO PROPRIA");
  });
});

describe("⚠ CÓDIGO FORA DA FORMA — aparece, não some", () => {
  test("o cadastro torto é mostrado, e NÃO vira opção", async () => {
    await renderizar(empresaCom({ codigosServicoNacional: ["070201", "31.01"] }));
    // ⚠ Sumir faria o cliente achar que a empresa tem MENOS códigos do que tem. A coluna não tem
    // CHECK no banco, então isto acontece de verdade.
    expect(screen.getByText(/fora da forma de 6 dígitos/i)).toBeInTheDocument();
    expect(screen.getByText(/31\.01/)).toBeInTheDocument();
    // Com um válido só, não há seletor — e o torto não entrou.
    expect(seletor()).not.toBeInTheDocument();
    expect(screen.getByText("070201")).toBeInTheDocument();
  });
});

describe("⚠ SEM CÓDIGO NENHUM — a tela diz, e não inventa", () => {
  test("nem seletor, nem código: a tela manda falar com o contador", async () => {
    await renderizar(empresaCom({ codigoServicoNacional: null, codigosServicoNacional: [] }));
    expect(seletor()).not.toBeInTheDocument();
    expect(screen.getByText(/Não recebemos nenhum código de serviço cadastrado/i)).toBeInTheDocument();
  });
});
