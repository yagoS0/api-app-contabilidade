// O SELETOR DE TOMADORES JÁ EMITIDOS — a LIGAÇÃO.
//
// > Dono (20/08/2026): *"na aba de emissão deve haver um seletor para selecionarmos tomadores já
// > emitidos."*
//
// ⚠⚠ **COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO** — já houve bloco novo
// renderizando `null` para sempre porque a prop nunca era passada, e a página de planejamento
// tributário passou meses com o pré-preenchimento pronto e ninguém passando a empresa. Por isso
// cada invariante negativa daqui ("sem tomadores, sem seletor") vem com a positiva ("com
// tomadores, aparece e preenche").
//
// ⚠ A regra pura tem suíte própria (`lib/__tests__/tomadoresEmitidos.test.js`). Aqui se prova que
// ela CHEGA aos campos.
//
// ⚠⚠ **NADA É EMITIDO, CANCELADO OU TRANSMITIDO.** `api.emitirNfse` é uma armadilha que EXPLODE se
// chamada, e um `afterEach` confere que ela continua intocada em todos os casos. O `fetch` global
// também explode.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    codigoServicoMunicipal: "1.01",
    rpsSerie: "1",
  },
};

/** Como a rota devolve: nomes da DPS, `null` para o que a emissão não teve. */
const AURORA = {
  documento: "11222333000181",
  nome: "COMERCIAL AURORA LTDA",
  email: "financeiro@aurora.com.br",
  cMun: "3550308",
  cep: "01310930",
  xLgr: "AVENIDA PAULISTA",
  nro: "1578",
  xCpl: "CONJ 42",
  xBairro: "BELA VISTA",
  ultimaEmissaoEm: "2026-08-12T14:20:00.000Z",
};

const YAGO = {
  documento: "12219079724",
  nome: "Yago Almeida Santos",
  email: null,
  cMun: null,
  cep: null,
  xLgr: null,
  nro: null,
  xCpl: null,
  xBairro: null,
  ultimaEmissaoEm: "2026-06-15T16:40:00.000Z",
};

let fetchOriginal;

beforeEach(() => {
  window.localStorage.clear();
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "getTomadoresEmitidos").mockResolvedValue([AURORA, YAGO]);
  jest
    .spyOn(api, "consultarCnpj")
    .mockResolvedValue({ ok: false, motivo: "nao_encontrado", mensagem: "CNPJ não encontrado." });
  // ⚠⚠ EMITIR É ATO FISCAL IRREVERSÍVEL. Aqui é armadilha, não mock complacente.
  jest.spyOn(api, "emitirNfse").mockImplementation(() => {
    throw new Error("⚠ NENHUM TESTE PODE EMITIR NFS-e");
  });
});

afterEach(() => {
  expect(api.emitirNfse).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

async function renderizar(empresa = EMPRESA) {
  const utils = render(
    <EmitirNotaPage empresa={empresa} aoVoltarParaNotas={() => {}} aoRecarregarEmpresas={() => {}} />
  );
  await act(async () => {});
  return utils;
}

const campoBusca = () => document.getElementById("emitir-tomador-memoria");
const valorDe = (id) => document.getElementById(id).value;

/** Abre a lista e devolve as opções renderizadas. */
function abrirLista(termo = "") {
  fireEvent.focus(campoBusca());
  if (termo) fireEvent.change(campoBusca(), { target: { value: termo } });
  return screen.queryAllByRole("option");
}

describe("⚠ o seletor está LIGADO — e pede a lista à empresa certa", () => {
  test("a rota é chamada com o `companyId` da tela", async () => {
    await renderizar();
    expect(api.getTomadoresEmitidos).toHaveBeenCalledWith("pc-001");
  });

  test("com tomadores, o campo de busca aparece", async () => {
    await renderizar();
    expect(campoBusca()).toBeInTheDocument();
  });

  test("⚠⚠ SEM TOMADORES, O SELETOR NÃO APARECE — e NADA é dito", async () => {
    api.getTomadoresEmitidos.mockResolvedValue([]);
    await renderizar();

    expect(campoBusca()).not.toBeInTheDocument();
    // ⚠ Critério literal do dono: *"sem sugestão não precisa ser falado, pois já está sem"*.
    // ⚠ A varredura é sobre as frases DO SELETOR, não sobre a palavra "tomador": o formulário tem
    // "CNPJ ou CPF do tomador" e "Endereço do tomador" o tempo todo, e um `not.toMatch(/tomador/i)`
    // acenderia por eles — passando pelo motivo errado no dia em que o seletor voltasse mudo.
    expect(document.body.textContent).not.toMatch(/Tomador para quem você já emitiu/i);
    expect(document.body.textContent).not.toMatch(/nota já emitida/i);
    expect(document.body.textContent).not.toMatch(/você ainda não emitiu/i);
  });

  test("⚠ falha ao ler a memória também não vira frase — a emissão segue, sem seletor", async () => {
    api.getTomadoresEmitidos.mockRejectedValue(new Error("offline"));
    await renderizar();

    expect(campoBusca()).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Tomador para quem você já emitiu/i);
    expect(document.body.textContent).not.toMatch(/nota já emitida/i);
    // O formulário continua inteiro: a memória é conveniência, nunca portão.
    expect(document.getElementById("emitir-doc")).toBeInTheDocument();
  });
});

describe("⚠⚠ ENCONTRA, NUNCA ESCOLHE", () => {
  test("nada vem pré-selecionado: o formulário abre vazio mesmo com a lista carregada", async () => {
    await renderizar();
    expect(valorDe("emitir-doc")).toBe("");
    expect(valorDe("emitir-nome")).toBe("");
  });

  test("⚠⚠ RESULTADO ÚNICO NÃO SE AUTOSSELECIONA", async () => {
    await renderizar();
    const opcoes = abrirLista("aurora");
    expect(opcoes).toHaveLength(1);
    // Está na lista, e só. O formulário continua intocado.
    expect(valorDe("emitir-doc")).toBe("");
  });

  test("⚠⚠ `Enter` SEM ITEM MARCADO NÃO ELEGE NINGUÉM — e não emite a nota", async () => {
    await renderizar();
    abrirLista("aurora");
    fireEvent.keyDown(campoBusca(), { key: "Enter" });

    expect(valorDe("emitir-doc")).toBe("");
    // ⚠ O `afterEach` também mede isto, mas aqui é o ponto do caso: dentro de um `<form>`, `Enter`
    // envia. Este formulário emite nota fiscal.
    expect(api.emitirNfse).not.toHaveBeenCalled();
  });

  test("com a seta marcando, `Enter` escolhe", async () => {
    await renderizar();
    abrirLista("aurora");
    fireEvent.keyDown(campoBusca(), { key: "ArrowDown" });
    fireEvent.keyDown(campoBusca(), { key: "Enter" });

    await waitFor(() => expect(valorDe("emitir-doc")).toBe("11222333000181"));
  });

  test("toda linha mostra o NOME e o DOCUMENTO — é o documento que desempata homônimo", async () => {
    await renderizar();
    const [primeira] = abrirLista("");
    expect(primeira.textContent).toMatch(/COMERCIAL AURORA LTDA/);
    expect(primeira.textContent).toMatch(/11\.222\.333\/0001-81/);
  });

  test("a busca casa por documento também", async () => {
    await renderizar();
    const opcoes = abrirLista("122190");
    expect(opcoes).toHaveLength(1);
    expect(opcoes[0].textContent).toMatch(/Yago/);
  });
});

describe("⚠ ESCOLHER PREENCHE O TOMADOR INTEIRO — com a origem à vista", () => {
  async function escolherAurora() {
    await renderizar();
    abrirLista("aurora");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]);
    });
  }

  test("documento, nome, e-mail e o endereço TODO", async () => {
    await escolherAurora();

    expect(valorDe("emitir-doc")).toBe("11222333000181");
    expect(valorDe("emitir-nome")).toBe("COMERCIAL AURORA LTDA");
    expect(valorDe("emitir-email")).toBe("financeiro@aurora.com.br");
    expect(valorDe("emitir-cep")).toBe("01310930");
    expect(valorDe("emitir-logradouro")).toBe("AVENIDA PAULISTA");
    expect(valorDe("emitir-numero")).toBe("1578");
    expect(valorDe("emitir-complemento")).toBe("CONJ 42");
    expect(valorDe("emitir-bairro")).toBe("BELA VISTA");
  });

  test("⚠ o município entra pelo seletor próprio, com o código IBGE da nota anterior", async () => {
    await escolherAurora();
    // O `SeletorMunicipio` mostra o código escolhido quando ele tem os 7 dígitos.
    await waitFor(() => expect(document.body.textContent).toMatch(/3550308/));
  });

  test("⚠ A ORIGEM FICA À VISTA — e ela diz 'de uma nota já emitida', não 'digitado'", async () => {
    await escolherAurora();
    expect(screen.getAllByText("de uma nota já emitida").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll('[data-origem="da_memoria"]').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Preenchido a partir de uma nota já emitida para/i)).toBeInTheDocument();
  });

  test("⚠ o registro INCOMPLETO preenche o que tem, e não inventa o resto", async () => {
    await renderizar();
    abrirLista("yago");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]);
    });

    expect(valorDe("emitir-doc")).toBe("12219079724");
    expect(valorDe("emitir-nome")).toBe("Yago Almeida Santos");
    // ⚠ A emissão anterior não teve e-mail (`email: null`): o campo continua vazio. "Não teve" não
    // vira `""` escrito nem endereço inventado — invariante 1 de `tomadorEmitido.js`.
    expect(valorDe("emitir-email")).toBe("");
    // A emissão anterior não teve endereço: os campos continuam vazios, e nada foi fabricado.
    expect(valorDe("emitir-cep")).toBe("");
    expect(valorDe("emitir-logradouro")).toBe("");
  });

  test("⚠ CPF escolhido NÃO dispara consulta na Receita — a BrasilAPI é base de CNPJ", async () => {
    await renderizar();
    abrirLista("yago");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]);
    });
    expect(api.consultarCnpj).not.toHaveBeenCalled();
  });

  test("⚠⚠ A CONSULTA DO CNPJ NÃO SOBRESCREVE O QUE VEIO DA MEMÓRIA", async () => {
    // A escolha preenche o documento, e é isso que dispara a consulta. Sem a precedência, a
    // resposta da Receita chegaria segundos depois e trocaria o endereço que a nota anterior de
    // fato teve — em silêncio.
    api.consultarCnpj.mockResolvedValue({
      ok: true,
      situacao: { texto: "ATIVA", ativa: true, motivo: null, data: null },
      bruto: {
        razao_social: "OUTRO NOME NA RECEITA LTDA",
        municipio: "SAO PAULO",
        uf: "SP",
        codigo_municipio_ibge: "3550308",
        descricao_tipo_de_logradouro: "RUA",
        logradouro: "DIFERENTE",
        numero: "999",
        bairro: "OUTRO BAIRRO",
        cep: "01001-000",
      },
    });
    await escolherAurora();
    await waitFor(() => expect(api.consultarCnpj).toHaveBeenCalled());
    await act(async () => {});

    expect(valorDe("emitir-nome")).toBe("COMERCIAL AURORA LTDA");
    expect(valorDe("emitir-logradouro")).toBe("AVENIDA PAULISTA");
  });
});

describe("⚠⚠ O DIGITADO VENCE — e escolher não apaga sem a pessoa ver", () => {
  async function digitarEEscolher() {
    await renderizar();
    fireEvent.change(document.getElementById("emitir-nome"), {
      target: { value: "COMERCIAL AURORA LTDA - FILIAL" },
    });
    fireEvent.change(document.getElementById("emitir-logradouro"), { target: { value: "RUA NOVA" } });
    abrirLista("aurora");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]);
    });
  }

  test("o que a pessoa digitou continua lá", async () => {
    await digitarEEscolher();
    expect(valorDe("emitir-nome")).toBe("COMERCIAL AURORA LTDA - FILIAL");
    expect(valorDe("emitir-logradouro")).toBe("RUA NOVA");
  });

  test("⚠ e os campos VAZIOS ao lado são preenchidos assim mesmo — preservar não é desistir", async () => {
    await digitarEEscolher();
    expect(valorDe("emitir-bairro")).toBe("BELA VISTA");
    expect(valorDe("emitir-cep")).toBe("01310930");
  });

  test("⚠⚠ A TELA DIZ O QUE MANTEVE — 'vencer em silêncio' seria a nota sair pela metade", async () => {
    await digitarEEscolher();
    expect(
      screen.getByText(/Mantivemos o nome e o logradouro como você já tinha preenchido\./i)
    ).toBeInTheDocument();
  });

  test("⚠ a substituição existe, e é uma SEGUNDA decisão dela", async () => {
    await digitarEEscolher();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /usar os dados da nota anterior/i }));
    });

    expect(valorDe("emitir-nome")).toBe("COMERCIAL AURORA LTDA");
    expect(valorDe("emitir-logradouro")).toBe("AVENIDA PAULISTA");
    expect(screen.queryByText(/Mantivemos/i)).not.toBeInTheDocument();
  });

  test("⚠ escrever por cima de um campo tira o rótulo 'de uma nota já emitida' daquele grupo", async () => {
    await renderizar();
    abrirLista("aurora");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]);
    });
    expect(screen.getAllByText("de uma nota já emitida").length).toBe(2);

    fireEvent.change(document.getElementById("emitir-nome"), { target: { value: "OUTRA COISA" } });
    // ⚠ A frase que descreve um comportamento é parte do comportamento: o rótulo do NOME saiu, o do
    // ENDEREÇO ficou, porque o endereço continua sendo o da nota anterior.
    expect(screen.getAllByText("de uma nota já emitida").length).toBe(1);
  });
});
