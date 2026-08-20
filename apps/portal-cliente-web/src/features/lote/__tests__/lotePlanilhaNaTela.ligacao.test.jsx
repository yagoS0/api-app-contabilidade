// A LIGAÇÃO DO LOTE POR PLANILHA — da aba Notas até a linha conferida.
//
// > Dono (19/08/2026): *"a planilha deve ser baixada por nós o modelo, o cliente preenche; se o
// > CNPJ preenchido for de um tomador que já teve antes, só preencher; se não teve consultamos na
// > API; e se a API não retornar nós avisamos isso em uma tela para ajuste daquela nota."*
//
// ⚠⚠ COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO. As regras têm suíte própria
// (`lib/__tests__/`); o que este arquivo prova é a CORRENTE: a casca monta Notas, Notas mostra o
// botão, o botão abre a tela, a tela baixa o modelo por Blob, manda a planilha, mostra os quatro
// estados, consulta a Receita **em série**, ajusta a linha e reclassifica.
//
// ⚠⚠ **NADA EMITE.** `api.emitirNfse` é uma armadilha que explode, e o `fetch` global também.
//
// ⚠ Roda dentro do `StrictMode`, como o app (`src/main.jsx`): o React 19 executa cada efeito duas
// vezes, e é assim que guarda de "já fiz isso" morre.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../../api";
import { definirTokens } from "../../../api/sessionStore";
import { AppShell } from "../../shell/AppShell";

const EMPRESA = {
  companyId: "pc-001",
  razao: "ACME SERVICOS LTDA",
  cnpj: "11222333000181",
  myRole: "OWNER",
  emissaoNfseLiberada: true,
  legacyCompany: { regimeTributario: "SIMPLES_NACIONAL", inscricaoMunicipal: "1234567", rpsSerie: "1" },
};

const RESPOSTA_DE_NOTAS = {
  data: [],
  page: 1,
  limit: 25,
  total: 0,
  summary: { totalInvoices: 0, totalAmount: 0, pageAmount: 0 },
};

let fetchOriginal;
let cliques;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  cliques = [];
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("⚠ nenhum teste desta suíte pode tocar a rede");
  });
  URL.createObjectURL = jest.fn(() => "blob:mock");
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function interceptar() {
    cliques.push({ href: this.href, download: this.download });
  });

  jest.spyOn(api, "getCompanies").mockResolvedValue([EMPRESA]);
  jest.spyOn(api, "getInvoices").mockResolvedValue(RESPOSTA_DE_NOTAS);
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  // ⚠ As funções do lote NÃO são substituídas: o mock é o backend desta suíte, e é ele que garante
  // que todos os estados de linha existam offline. O espião só observa.
  jest.spyOn(api, "lerPlanilhaDoLote");
  jest.spyOn(api, "baixarModeloDoLote");
  jest.spyOn(api, "consultarCnpj");
  // ⚠ Espiões, não substitutos: o mock continua sendo o backend desta suíte. O que se observa é
  // SE e COM O QUÊ a emissão foi chamada.
  jest.spyOn(api, "emitirLoteDeNotas");
  jest.spyOn(api, "consultarLoteEmissao");
  jest.spyOn(api, "retomarLoteEmissao");
  jest.spyOn(api, "emitirNfse").mockImplementation(() => {
    throw new Error("⚠⚠ NENHUM TESTE PODE EMITIR NFS-e");
  });
});

afterEach(() => {
  expect(api.emitirNfse).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  window.location.hash = "";
  jest.restoreAllMocks();
});

function planilha(nome = "notas.xlsx") {
  return new File(["conteudo"], nome, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function abrirLote() {
  // ⚠ O MOCK É O BACKEND DESTA SUÍTE, e ele confere a sessão como o servidor confere (é o que
  // impede um mock de responder para quem não está logado). A casca recebe o `user` por prop, mas
  // os tokens precisam existir de verdade.
  const sessao = await api.login("cliente@exemplo.com", "123456");
  definirTokens({ accessToken: sessao.accessToken, refreshToken: sessao.refreshToken });

  render(
    <StrictMode>
      <AppShell user={{ defaultClientId: "pc-001" }} />
    </StrictMode>
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Notas" }));
  await act(async () => {});
  await screen.findByText("Notas emitidas");
  fireEvent.click(screen.getByRole("button", { name: /Preparar lote por planilha/i }));
  await act(async () => {});
  await screen.findByText("Preparar lote por planilha", { selector: "h1" });
}

async function subirPlanilha() {
  const campo = screen.getByLabelText(/Planilha/i);
  fireEvent.change(campo, { target: { files: [planilha()] } });
  await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalled());
  await screen.findByText(/Confira, linha a linha/i);
  // A conferência do município depende da lista oficial, que entra por `import()` dinâmico.
  await waitFor(() => expect(screen.getAllByText(/Rio de Janeiro \/ RJ/).length).toBeGreaterThan(0));
}

describe("a corrente: da aba Notas à tela de conferência", () => {
  test("⚠ O BOTÃO EXISTE NA ABA NOTAS e abre a tela do lote", async () => {
    await abrirLote();
    expect(screen.getByText("Preparar lote por planilha", { selector: "h1" })).toBeInTheDocument();
    // ⚠ "Preparar", nunca "Emitir em lote": a tela do outro lado não emite.
    expect(screen.queryByRole("button", { name: /^Emitir em lote/i })).toBeNull();
  });

  test("⚠⚠ o modelo vem por `fetch` autenticado e é entregue como Blob — nunca por `<a href>`", async () => {
    await abrirLote();
    expect(document.querySelector("a[download]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Baixar modelo/i }));
    await waitFor(() => expect(cliques).toHaveLength(1));
    expect(api.baixarModeloDoLote).toHaveBeenCalledWith("pc-001");
    expect(cliques[0].href).toBe("blob:mock");
    expect(cliques[0].download).toBe("modelo-emissao-em-lote.xlsx");
  });

  test("a planilha escolhida é mandada para a empresa do contexto", async () => {
    await abrirLote();
    await subirPlanilha();
    const [companyId, arquivo] = api.lerPlanilhaDoLote.mock.calls[0];
    expect(companyId).toBe("pc-001");
    expect(arquivo.name).toBe("notas.xlsx");
  });
});

describe("⚠⚠ quantas estão prontas e quantas não — sempre à vista", () => {
  test("os dois números aparecem, e batem com as linhas da tabela", async () => {
    await abrirLote();
    await subirPlanilha();

    const prontas = Number(document.querySelector('[data-lote="prontas"]').textContent);
    const naoProntas = Number(document.querySelector('[data-lote="nao-prontas"]').textContent);
    const linhas = document.querySelectorAll("tr[data-estado-lote]");
    expect(prontas + naoProntas).toBe(linhas.length);
    expect(prontas).toBeGreaterThan(0);
    expect(naoProntas).toBeGreaterThan(0);
  });

  test("os quatro estados aparecem desenhados na tabela", async () => {
    await abrirLote();
    await subirPlanilha();
    for (const estado of ["pronta", "conferir", "consultar", "pendente"]) {
      expect(document.querySelector(`tr[data-estado-lote="${estado}"]`)).not.toBeNull();
    }
  });
});

describe("⚠⚠ a conferência do município acontece AQUI — o servidor não tem a lista", () => {
  test("o código válido é resolvido e a tela mostra município E UF", async () => {
    await abrirLote();
    await subirPlanilha();
    expect(screen.getAllByText(/Rio de Janeiro \/ RJ/).length).toBeGreaterThan(0);
  });

  test("⚠⚠ o código que não existe na lista oficial derruba a linha para PENDENTE na tela", async () => {
    await abrirLote();
    await subirPlanilha();

    const aviso = document.querySelector('[data-codigo="municipio_inexistente"]');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toMatch(/9999999/);
    // A MESMA linha voltou do servidor como `conferir`.
    const doServidor = api.lerPlanilhaDoLote.mock.results[0].value;
    const numero = Number(aviso.closest("tr").dataset.linha);
    await expect(doServidor).resolves.toBeTruthy();
    const resposta = await doServidor;
    expect(resposta.linhas.find((l) => l.numero === numero).estado).toBe("conferir");
    expect(aviso.closest("tr").dataset.estadoLote).toBe("pendente");
  });
});

describe("⚠⚠ o segundo passe da consulta sai do NAVEGADOR, em série", () => {
  test("consulta só os CNPJs da lista, e o CPF nunca é consultado", async () => {
    await abrirLote();
    await subirPlanilha();

    fireEvent.click(screen.getByRole("button", { name: /Consultar \d+ CNPJ/i }));
    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2), { timeout: 5000 });

    const consultados = api.consultarCnpj.mock.calls.map(([d]) => String(d).replace(/\D+/g, ""));
    expect(consultados.length).toBeGreaterThan(0);
    for (const doc of consultados) expect(doc).toHaveLength(14);
    // ⚠ CPF NÃO SE CONSULTA — decisão do dono. Os CPFs da planilha estão plantados no mock.
    expect(consultados).not.toContain("12345678909");
  });

  test("⚠ o resultado volta ao servidor no MESMO pedido, como `consultas`", async () => {
    await abrirLote();
    await subirPlanilha();
    fireEvent.click(screen.getByRole("button", { name: /Consultar \d+ CNPJ/i }));
    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2), { timeout: 5000 });

    const [, , opcoes] = api.lerPlanilhaDoLote.mock.calls[1];
    expect(Object.keys(opcoes.consultas || {}).length).toBeGreaterThan(0);
    // ⚠ E a consulta que FALHOU virou pendência daquela linha, sem derrubar as outras.
    const resposta = await api.lerPlanilhaDoLote.mock.results[1].value;
    const codigos = resposta.linhas.flatMap((l) => (l.pendencias || []).map((p) => p.codigo));
    expect(codigos).toContain("consulta_falhou");
    expect(resposta.resumo.prontas).toBeGreaterThan(0);
  });

  test("depois de consultar, o botão de consulta some — não há o que consultar", async () => {
    await abrirLote();
    await subirPlanilha();
    fireEvent.click(screen.getByRole("button", { name: /Consultar \d+ CNPJ/i }));
    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Consultar \d+ CNPJ/i })).toBeNull());
  });
});

describe("⚠ ajustar a linha pendente e reclassificar", () => {
  async function abrirAjusteDaLinha(codigo) {
    await abrirLote();
    await subirPlanilha();
    const aviso = document.querySelector(`[data-codigo="${codigo}"]`);
    expect(aviso).not.toBeNull();
    const tr = aviso.closest("tr");
    fireEvent.click(within(tr).getByRole("button", { name: "Ajustar" }));
    await act(async () => {});
    return Number(tr.dataset.linha);
  }

  test("o formulário abre com o que a planilha trouxe — a pessoa vê o que vai corrigir", async () => {
    await abrirAjusteDaLinha("endereco_incompleto");
    expect(screen.getByLabelText(/Logradouro do tomador/i)).toHaveValue("Rua da Assembleia");
  });

  test("⚠ só o que MUDOU é enviado, chaveado pelo NÚMERO DA LINHA DO EXCEL", async () => {
    const numero = await abrirAjusteDaLinha("endereco_incompleto");

    fireEvent.change(screen.getByLabelText(/Código IBGE do município do tomador/i), {
      target: { value: "3304557" },
    });
    fireEvent.change(screen.getByLabelText(/^Número$/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^Bairro$/i), { target: { value: "Centro" } });
    fireEvent.click(screen.getByRole("button", { name: /Aplicar e reclassificar/i }));

    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2));
    const [, , opcoes] = api.lerPlanilhaDoLote.mock.calls[1];
    expect(opcoes.ajustes).toEqual({ [numero]: { cMun: "3304557", nro: "10", xBairro: "Centro" } });
  });

  test("a linha ajustada deixa de ser pendente e a tela diz que ela foi ajustada aqui", async () => {
    const numero = await abrirAjusteDaLinha("endereco_incompleto");
    fireEvent.change(screen.getByLabelText(/Código IBGE do município do tomador/i), {
      target: { value: "3304557" },
    });
    fireEvent.change(screen.getByLabelText(/^Número$/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^Bairro$/i), { target: { value: "Centro" } });
    fireEvent.click(screen.getByRole("button", { name: /Aplicar e reclassificar/i }));

    await waitFor(() => expect(api.lerPlanilhaDoLote).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(document.querySelector(`tr[data-linha="${numero}"]`).dataset.estadoLote).toBe("conferir")
    );
    // ⚠⚠ AUSÊNCIA QUE MUDA DECISÃO: o ajuste vive nesta tela, e a planilha no disco não sabe dele.
    expect(screen.getByText(/a sua planilha continua com o valor antigo/i)).toBeInTheDocument();
  });
});

// ⚠⚠ ESTE BLOCO FOI **INVERTIDO**, NÃO APAGADO (20/08/2026).
//
// Ele travava o oposto: *"não existe nenhum botão que emita"* + *"e a ausência é DITA"*. Existia
// para ninguém "consertar" por conta própria uma fase que ainda não tinha as regras da emissão em
// série. As regras foram construídas, e a trava mudou de lado — agora ela prende o desenho novo:
// o ato existe, mas **atrás de uma confirmação**, e nunca a um clique de distância.
//
// Manter o histórico aqui importa: quem ler daqui a seis meses precisa saber que houve DUAS
// decisões, senão a primeira volta "consertando" a segunda.
describe("⚠⚠ o botão de emitir — existe, e só depois de confirmar", () => {
  test("⚠ o primeiro clique NÃO emite: ele abre a confirmação", async () => {
    await abrirLote();
    await subirPlanilha();

    const botao = await screen.findByRole("button", { name: /emitir \d+ nota/i });
    fireEvent.click(botao);

    // ⚠⚠ A prova de que o ato não aconteceu: a API de emissão não foi chamada.
    expect(api.emitirLoteDeNotas).not.toHaveBeenCalled();
    expect(screen.getByText(/A emissão é definitiva/i)).toBeInTheDocument();
  });

  test("⚠ dá para desistir na confirmação, e nada é emitido", async () => {
    await abrirLote();
    await subirPlanilha();
    fireEvent.click(await screen.findByRole("button", { name: /emitir \d+ nota/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(api.emitirLoteDeNotas).not.toHaveBeenCalled();
  });

  test("⚠⚠ confirmando, o que vai para a API é o ARQUIVO — nunca a lista de linhas", async () => {
    await abrirLote();
    await subirPlanilha();
    fireEvent.click(await screen.findByRole("button", { name: /emitir \d+ nota/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirmar e emitir/i }));
    });

    expect(api.emitirLoteDeNotas).toHaveBeenCalledTimes(1);
    const [companyId, arquivo, opcoes] = api.emitirLoteDeNotas.mock.calls[0];
    expect(companyId).toBe("pc-001");
    expect(arquivo).toBeInstanceOf(File);
    // ⚠ Nenhuma chave que signifique "estas são as linhas a emitir": quem decide é o servidor,
    // reclassificando a planilha inteira.
    expect(Object.keys(opcoes || {}).sort()).toEqual(["ajustes", "consultas"]);
  });
});
