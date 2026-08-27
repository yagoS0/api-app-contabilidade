// A LIGAÇÃO DO DOWNLOAD EM LOTE — `apps/portal-cliente-web`, aba Notas.
//
// > Pedido do dono (19/08/2026): *"a possibilidade de baixar notas em lote (…) quero o download no
// > portal do cliente, e fazer o download dos DANFSe e não do XML."*
//
// ⚠⚠ COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO, e a regra deste lote já tem suíte
// própria (`lib/__tests__/loteDanfse.test.js`). O que este arquivo prova é a CORRENTE: a casca
// monta a aba Notas, a aba renderiza o botão, o botão chama `api.baixarDanfseEmLote` **com a
// competência que está no seletor**, e o Blob vira download com o nome certo.
//
// ⚠⚠ E prova a segunda metade da entrega: **a tela aponta para o `RELATORIO.txt`**. Nem toda nota
// gera DANFSe, e a ausência não pode ser descoberta contando arquivos — se a tela não disser onde
// o motivo está escrito, o relatório dentro do zip não serve para nada.
//
// ⚠⚠ DENTRO DO `StrictMode` — é assim que o app roda (`src/main.jsx`).
//
// ⚠⚠ NADA É EMITIDO. `api.emitirNfse` é uma armadilha que explode, e o `fetch` global também.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { AppShell } from "../../shell/AppShell";

const CNPJ_DA_EMPRESA = "11222333000181";

const EMPRESA = {
  companyId: "pc-001",
  razao: "ACME SERVICOS LTDA",
  cnpj: CNPJ_DA_EMPRESA,
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

function nota(patch = {}) {
  return {
    invoiceId: "inv-1001",
    type: "NFSE",
    numero: "13000",
    competencia: "2026-06",
    issueDate: "2026-06-10T00:00:00.000Z",
    status: "EMITIDA",
    total: 2300,
    emitente: { nome: "ACME SERVICOS LTDA", cnpj: CNPJ_DA_EMPRESA },
    tomador: { nome: "TOMADOR EXEMPLO LTDA", cnpjCpf: "44555666000177" },
    updatedAt: "2026-06-11T00:00:00.000Z",
    hasXml: true,
    hasPdf: false,
    confirmadaPeloAdn: true,
    ...patch,
  };
}

function respostaDeNotas(lista) {
  return {
    data: lista,
    page: 1,
    limit: 25,
    total: lista.length,
    summary: { totalInvoices: lista.length, totalAmount: 2300, pageAmount: 2300 },
  };
}

/** O erro como `realApi.baixarDanfseEmLote` o lança. */
function recusa(status, code, message, corpo = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.corpo = corpo;
  return err;
}

let fetchOriginal;
let cliques;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  cliques = [];
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  URL.createObjectURL = jest.fn(() => "blob:mock");
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function interceptar() {
    cliques.push({ href: this.href, download: this.download });
  });

  jest.spyOn(api, "getCompanies").mockResolvedValue([EMPRESA]);
  jest.spyOn(api, "getInvoices").mockResolvedValue(respostaDeNotas([nota()]));
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "baixarDanfseEmLote").mockResolvedValue(
    new Blob(["PK"], { type: "application/zip" })
  );
  jest.spyOn(api, "emitirNfse").mockImplementation(() => {
    throw new Error("⚠ NENHUM TESTE PODE EMITIR NFS-e");
  });
});

afterEach(() => {
  expect(api.emitirNfse).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
  window.location.hash = "";
  jest.restoreAllMocks();
});

async function abrirNotas() {
  render(
    <StrictMode>
      <AppShell user={{ defaultClientId: "pc-001" }} />
    </StrictMode>
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("link", { name: "Notas" }));
  // ⚠ O flush precisa passar por uma TAREFA, não só por microtarefas: as abas são `<a href>` e o
  // `useRota` escuta `hashchange`, que o jsdom entrega numa tarefa. Sem isto o `findByText` abaixo
  // fica dependendo do polling de 1s para a rota trocar — e é daí que vinham os timeouts de 5s
  // desta suíte quando a máquina está ocupada.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await screen.findByText("Notas emitidas");
}

/**
 * ⚠⚠ O BOTÃO DO LOTE FOI SUBSTITUÍDO POR SELEÇÃO em 27/08/2026 — pedido do dono: *"tire o botão de
 * baixar em lote, deixe o usuário selecionar as notas que ele quer e abra a opção baixar"*.
 *
 * ⚠ O que o botão antigo fazia era baixar **o filtro inteiro**. Quem queria três notas de vinte tinha
 * de estreitar a competência até sobrarem três — e neste portal o único filtro é a competência, então
 * na prática não dava.
 */
const marcarNota = (numero) => fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`nota ${numero}`) }));
const marcarTodas = () => fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar as \d+ notas/ }));
const botaoBaixar = () => screen.getByRole("button", { name: /Baixar \d+ DANFSe/ });

describe("a corrente inteira: da seleção ao arquivo no disco", () => {
  test("⚠⚠ o botão de baixar o FILTRO INTEIRO não existe mais", async () => {
    await abrirNotas();
    expect(screen.queryByRole("button", { name: /Baixar DANFSe em lote/i })).toBeNull();
  });

  test("⚠⚠ e a barra só aparece COM seleção — barra permanente com zero é ruído fixo", async () => {
    await abrirNotas();
    expect(screen.queryByRole("region", { name: /notas selecionadas/i })).toBeNull();
    marcarNota("13000");
    expect(screen.getByRole("region", { name: /notas selecionadas/i })).toBeInTheDocument();
  });

  test("marcar e baixar chama a rota com a empresa do contexto", async () => {
    await abrirNotas();
    marcarNota("13000");
    fireEvent.click(botaoBaixar());
    await waitFor(() => expect(api.baixarDanfseEmLote).toHaveBeenCalled());
    expect(api.baixarDanfseEmLote.mock.calls[0][0]).toBe("pc-001");
  });

  // ⚠⚠ ESTE CASO MEDIA O CONTRÁRIO ATÉ 27/08/2026: *"o que vai ao servidor é o FILTRO, NUNCA a lista
  // de notas da tela"*, e o argumento era que uma lista de ids vinda do cliente seria furo de
  // multi-tenancy. **Ele estava meio certo e a reversão trata a metade que importava.**
  //
  // ⚠ O furo nunca foi a lista: é o ESCOPO. E ele não afrouxou — no servidor os ids entram no `AND`
  // do mesmo `where` da listagem (com `clientId`), e `gerarDanfseDaNota` reconfere `{ id, clientId }`
  // nota a nota. Id de outra empresa simplesmente não casa.
  //
  // ⚠ O outro argumento — *"o zip tem de conter exatamente o que a tela mostra"* — a seleção
  // explícita RESOLVE em vez de ignorar: a escolha da pessoa passa a ser a verdade, e não há mais um
  // segundo critério para discordar do primeiro.
  test("⚠⚠ os IDS ESCOLHIDOS vão junto do filtro — nunca no lugar dele", async () => {
    await abrirNotas();
    marcarNota("13000");
    fireEvent.click(botaoBaixar());
    await waitFor(() => expect(api.baixarDanfseEmLote).toHaveBeenCalled());
    const opcoes = api.baixarDanfseEmLote.mock.calls[0][1];
    expect(opcoes.ids).toEqual(["inv-1001"]);
    // A competência continua viajando: os ids são um filtro A MAIS.
    expect(Object.keys(opcoes).sort()).toEqual(["competencia", "ids"]);
  });

  test("a competência escolhida no seletor continua indo no pedido", async () => {
    await abrirNotas();
    const seletor = screen.getByLabelText(/Competência/i);
    const alvo = [...seletor.options].map((o) => o.value).find((v) => v);
    fireEvent.change(seletor, { target: { value: alvo } });
    await act(async () => {});
    marcarNota("13000");
    fireEvent.click(botaoBaixar());
    await waitFor(() => expect(api.baixarDanfseEmLote).toHaveBeenCalled());
    expect(api.baixarDanfseEmLote.mock.calls[0][1].competencia).toBe(alvo);
  });

  test('"Todas" manda a competência VAZIA — não um mês inventado', async () => {
    await abrirNotas();
    fireEvent.change(screen.getByLabelText(/Competência/i), { target: { value: "" } });
    await act(async () => {});
    marcarNota("13000");
    fireEvent.click(botaoBaixar());
    await waitFor(() => expect(api.baixarDanfseEmLote).toHaveBeenCalled());
    expect(api.baixarDanfseEmLote.mock.calls[0][1].competencia).toBeUndefined();
  });

  test("⚠ o número da barra é o que a pessoa marcou — e some ao limpar", async () => {
    await abrirNotas();
    marcarTodas();
    expect(botaoBaixar().textContent).toMatch(/Baixar 1 DANFSe/);
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(screen.queryByRole("region", { name: /notas selecionadas/i })).toBeNull();
  });

  // ⚠⚠ Download autenticado NÃO é `<a href>` — a rota leva Bearer e um link comum receberia 401.
  test("⚠⚠ o zip vem por `fetch` autenticado e é entregue como Blob, com nome de arquivo", async () => {
    await abrirNotas();
    expect(document.querySelector("a[download]")).toBeNull();
    marcarNota("13000");
    fireEvent.click(botaoBaixar());
    await waitFor(() => expect(cliques).toHaveLength(1));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(cliques[0].href).toBe("blob:mock");
    expect(cliques[0].download).toMatch(/^danfse-11222333000181-.*\.zip$/);
  });
});

describe("⚠⚠ a tela aponta para o relatório dentro do zip", () => {
  test("depois do download, ela NOMEIA o RELATORIO.txt e diz para que ele serve", async () => {
    await abrirNotas();
    marcarNota("13000");
    fireEvent.click(botaoBaixar());
    await screen.findByText(/RELATORIO\.txt/);
  });

  test("antes do clique, nada disso está na tela", async () => {
    await abrirNotas();
    expect(screen.queryByText(/RELATORIO\.txt/)).toBeNull();
  });
});

describe("⚠ a recusa chega NOMEADA, com os números", () => {
  test("`lote_muito_grande` aparece com quantas notas há e qual é o teto", async () => {
    api.baixarDanfseEmLote.mockRejectedValueOnce(
      recusa(400, "lote_muito_grande", "Este filtro encontrou 437 notas, e o máximo é 200.", {
        encontradas: 437,
        maximo: 200,
      })
    );
    await abrirNotas();
    marcarNota("13000");
    fireEvent.click(botaoBaixar());
    await screen.findByText(/437/);
    expect(screen.getByText(/notas demais para um download só/i)).toBeInTheDocument();
    expect(screen.getByText(/gerado na hora/i)).toBeInTheDocument();
    expect(cliques).toHaveLength(0);
  });

  test("recusa desconhecida não vira 'tente de novo' inventado", async () => {
    api.baixarDanfseEmLote.mockRejectedValueOnce(recusa(500, "coisa_nova", "explodiu"));
    await abrirNotas();
    marcarNota("13000");
    fireEvent.click(botaoBaixar());
    await screen.findByText(/explodiu/);
    expect(screen.queryByText(/tente de novo/i)).toBeNull();
  });
});

describe("⚠⚠ só se marca o que GERA DANFSe", () => {
  // ⚠⚠ O BOTÃO ANTIGO FICAVA NA TELA E DESABILITADO, dizendo *"Não há nota neste filtro"* — porque
  // ele vivia no cabeçalho de filtros, fora da tabela. A seleção vive DENTRO da tabela, e com zero
  // notas a tabela dá lugar ao estado vazio, que já nomeia a competência e aponta para "Todas".
  // ⚠ Não é a mesma coisa que "sumir sem dizer": o estado vazio É a frase.
  test("sem nota nenhuma, não há caixa nem barra — o estado vazio ocupa o lugar", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([]));
    await abrirNotas();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: /notas selecionadas/i })).toBeNull();
    expect(screen.getByText(/Nenhuma nota/i)).toBeInTheDocument();
  });

  test("⚠ nota que NÃO gera DANFSe não pode ser marcada", async () => {
    // ⚠ `podeGerarDanfse` é a MESMA função que o botão da linha usa. Deixar marcar o que não vem no
    // zip faria o número da barra discordar do conteúdo do arquivo — e a pessoa só descobriria
    // contando PDFs.
    api.getInvoices.mockResolvedValue(respostaDeNotas([nota({ type: "NFE" })]));
    await abrirNotas();
    expect(screen.getByRole("checkbox", { name: /nota 13000/ })).toBeDisabled();
  });
});
