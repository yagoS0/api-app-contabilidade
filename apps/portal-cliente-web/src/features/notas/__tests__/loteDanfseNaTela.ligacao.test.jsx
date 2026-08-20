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
  await act(async () => {});
  await screen.findByText("Notas emitidas");
}

const botaoLote = () => screen.getByRole("button", { name: /Baixar DANFSe em lote/i });

describe("a corrente inteira: da aba até o arquivo no disco", () => {
  test("⚠ O BOTÃO EXISTE NA ABA NOTAS e chama a rota do lote com a empresa do contexto", async () => {
    await abrirNotas();
    fireEvent.click(botaoLote());
    await waitFor(() => expect(api.baixarDanfseEmLote).toHaveBeenCalled());
    expect(api.baixarDanfseEmLote).toHaveBeenCalledWith("pc-001", expect.any(Object));
    expect(api.baixarDanfseEmLote.mock.calls[0][0]).toBe("pc-001");
  });

  // ⚠⚠ NENHUMA LISTA DE IDS SAI DAQUI. O que viaja é o filtro; quem resolve as notas é o servidor.
  // Uma lista de ids vinda do cliente é exatamente o furo de multi-tenancy que o desenho evita.
  test("⚠⚠ o que vai ao servidor é o FILTRO, nunca a lista de notas da tela", async () => {
    await abrirNotas();
    fireEvent.click(botaoLote());
    await waitFor(() => expect(api.baixarDanfseEmLote).toHaveBeenCalled());
    const opcoes = api.baixarDanfseEmLote.mock.calls[0][1];
    expect(Object.keys(opcoes)).toEqual(["competencia"]);
    expect(JSON.stringify(opcoes)).not.toContain("inv-1001");
  });

  test("a competência escolhida no seletor é a que vai no pedido", async () => {
    await abrirNotas();
    const seletor = screen.getByLabelText(/Competência/i);
    const alvo = [...seletor.options].map((o) => o.value).find((v) => v);
    fireEvent.change(seletor, { target: { value: alvo } });
    await act(async () => {});
    fireEvent.click(botaoLote());
    await waitFor(() => expect(api.baixarDanfseEmLote).toHaveBeenCalled());
    expect(api.baixarDanfseEmLote.mock.calls[0][1]).toEqual({ competencia: alvo });
  });

  test('"Todas" manda a competência VAZIA — não um mês inventado', async () => {
    await abrirNotas();
    fireEvent.change(screen.getByLabelText(/Competência/i), { target: { value: "" } });
    await act(async () => {});
    fireEvent.click(botaoLote());
    await waitFor(() => expect(api.baixarDanfseEmLote).toHaveBeenCalled());
    expect(api.baixarDanfseEmLote.mock.calls[0][1]).toEqual({ competencia: undefined });
  });

  // ⚠⚠ Download autenticado NÃO é `<a href>` — a rota leva Bearer e um link comum receberia 401.
  test("⚠⚠ o zip vem por `fetch` autenticado e é entregue como Blob, com nome de arquivo", async () => {
    await abrirNotas();
    expect(document.querySelector("a[download]")).toBeNull();
    fireEvent.click(botaoLote());
    await waitFor(() => expect(cliques).toHaveLength(1));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(cliques[0].href).toBe("blob:mock");
    expect(cliques[0].download).toMatch(/^danfse-11222333000181-.*\.zip$/);
  });
});

describe("⚠⚠ a tela aponta para o relatório dentro do zip", () => {
  test("depois do download, ela NOMEIA o RELATORIO.txt e diz para que ele serve", async () => {
    await abrirNotas();
    fireEvent.click(botaoLote());
    await screen.findByText(/RELATORIO\.txt/);
    expect(screen.getByText(/não geraram DANFSe/i)).toBeInTheDocument();
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
    fireEvent.click(botaoLote());
    await screen.findByText(/437/);
    expect(screen.getByText(/notas demais para um download só/i)).toBeInTheDocument();
    // ⚠ E o porquê do teto, que é o que impede a pessoa de ler isso como defeito do sistema.
    expect(screen.getByText(/gerado na hora/i)).toBeInTheDocument();
    // Nada foi baixado.
    expect(cliques).toHaveLength(0);
  });

  test("recusa desconhecida não vira 'tente de novo' inventado", async () => {
    api.baixarDanfseEmLote.mockRejectedValueOnce(recusa(500, "coisa_nova", "explodiu"));
    await abrirNotas();
    fireEvent.click(botaoLote());
    await screen.findByText(/explodiu/);
    expect(screen.queryByText(/tente de novo/i)).toBeNull();
  });
});

describe("o botão não oferece o que não existe", () => {
  test("sem nota no filtro, ele fica DESABILITADO dizendo por quê — e não some", async () => {
    api.getInvoices.mockResolvedValue(respostaDeNotas([]));
    await abrirNotas();
    const botao = botaoLote();
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/Não há nota/i));
  });
});
