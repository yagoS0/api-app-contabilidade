// ⚠⚠⚠ A LINHA GANHOU CONTA, «LANÇAR» E «FLUXO» — decisão do dono, 01/09/2026.
//
// > *"tudo que vem da nota vem em uma única linha, nessa linha podemos adicionar a conta e lançar,
// > ao lançar entra no fluxo. temos um botão fluxo, que apenas libera no fluxo mas não lança."*
//
// Antes disto a conta só existia dentro do modal: lançar uma despesa era abrir uma caixa, escolher
// e confirmar, uma por uma. E não havia como pôr uma despesa no fluxo sem levá-la ao razão.
//
// ⚠ O que este arquivo trava, em ordem de custo:
//   1. o botão de TIRAR do fluxo não pode reinserir a linha (`undefined` ≠ `null`);
//   2. lançar da linha usa a MESMA rota e a MESMA ação do modal — nunca um segundo verbo;
//   3. a tela manda o `codigoCompleto`, nunca o reduzido que o contador digita;
//   4. a dívida conhecida (dois botões para o mesmo ato) não sumir de vista.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetFila = jest.fn();
const mockGetPlano = jest.fn();
const mockPostAcao = jest.fn();
const mockPostFluxo = jest.fn();
const mockGetPendencias = jest.fn();

jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getConferenciaFila: (...a) => mockGetFila(...a),
    postConferenciaAcao: (...a) => mockPostAcao(...a),
    postConferenciaFluxo: (...a) => mockPostFluxo(...a),
    getChartOfAccounts: (...a) => mockGetPlano(...a),
    getConferenciaPendencias: (...a) => mockGetPendencias(...a),
  }),
}));

import { ConferenciaTab } from "../renderConferenciaTab";

const PLANO = [
  { codigo: "5", codigoCompleto: "111010001", nome: "Caixa", analitica: true },
  { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
];

const LINHA = {
  id: "dec-1",
  origem: "NOTA_RECEBIDA",
  // ⚠ `A_CONFERIR` de propósito: a data JÁ existe, então a ação não pede data e o caminho da linha
  // é o que vale. Em `AGUARDANDO_PAGAMENTO` o modal continua sendo o caminho (há teste abaixo).
  estado: "A_CONFERIR",
  valor: "1500.00",
  valorAjustado: null,
  competencia: "2026-07",
  descricaoOriginal: "GOOGLE CLOUD BRASIL",
  cnpjFornecedor: "12345678000190",
  dataDocumento: "2026-07-02",
  detalheServico: null,
  dataPagamento: "2026-07-15",
  origemPagamento: "OFX",
  mesFechado: false,
  contaSugerida: "411020001",
  sugestao: null,
  nota: null,
  previstoNoFluxoEm: null,
};

const responder = (extra = {}) =>
  mockGetFila.mockResolvedValue({ ok: true, itens: [{ ...LINHA, ...extra }], porEstado: {}, total: 1 });

beforeEach(() => {
  jest.clearAllMocks();
  responder();
  mockGetPlano.mockResolvedValue(PLANO);
  mockPostAcao.mockResolvedValue({ ok: true });
  mockPostFluxo.mockResolvedValue({ ok: true });
  mockGetPendencias.mockResolvedValue({ ok: true, declaradosForaDaCompetencia: 0 });
});

const montar = async () => {
  const r = render(<ConferenciaTab companyId="emp-1" competencia="2026-07" />);
  await waitFor(() => expect(screen.getAllByText("GOOGLE CLOUD BRASIL").length).toBeGreaterThan(0));
  return r;
};

const botao = (nome) => screen.getByRole("button", { name: nome });
const campoDaConta = () => screen.getByLabelText(/Conta contábil de GOOGLE CLOUD BRASIL/i);
const clicar = async (nome) => { await act(async () => { botao(nome).click(); }); };

describe("⚠⚠ a conta na própria linha", () => {
  it("o campo existe, e chega PREENCHIDO com a sugestão", async () => {
    // ⚠ Em reduzido — é o que o contador digita e lê. A tradução para `codigoCompleto` é no clique.
    await montar();
    await waitFor(() => expect(campoDaConta()).toHaveValue("401"));
  });

  it("⚠ ele NÃO aparece onde não há o que lançar — um campo ali prometeria edição inexistente", async () => {
    responder({ estado: "CONTABILIZADO", accountingEntryId: "ae-1" });
    await montar();
    expect(screen.queryByLabelText(/Conta contábil de/i)).toBeNull();
  });
});

describe("⚠⚠ «Lançar» da linha — mesma rota, mesma ação, sem modal", () => {
  it("⚠⚠ manda `confirmar` com o `codigoCompleto`, nunca o reduzido digitado", async () => {
    // Um segundo verbo aqui seria duas regras para o mesmo ato; e mandar o reduzido faria o
    // servidor recusar com uma conta que existe.
    await montar();
    await waitFor(() => expect(campoDaConta()).toHaveValue("401"));
    await clicar("Lançar");
    expect(mockPostAcao).toHaveBeenCalledWith("emp-1", "dec-1", "confirmar", { conta: "411020001" });
  });

  it("⚠⚠ e NÃO abre modal — era o clique a mais que o dono pediu para tirar", async () => {
    await montar();
    await waitFor(() => expect(campoDaConta()).toHaveValue("401"));
    await clicar("Lançar");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("⚠⚠ DÍVIDA CONHECIDA: a linha tem DOIS botões para o mesmo ato, e isto está com o dono", () => {
    // ⚠ Este teste afirma o estado ATUAL, não o desejado — e existe para a dívida não sumir de
    // vista. "Lançar" usa a conta da linha e não abre modal; "Confirmar" abre o modal.
    //
    // Tirar o segundo é uma linha em `renderConferenciaTab.jsx` MAIS a migração de ~15 casos de
    // `conferenciaNaTela.ligacao.test.jsx`, que alcançam o modal por ele — cada um guardando uma
    // garantia diferente. Quando o dono decidir, este teste vira o inverso.
    return montar().then(() => {
      expect(screen.getByRole("button", { name: "Lançar" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument();
    });
  });

  it("⚠⚠ quando a ação pede DATA, o caminho volta a ser o modal", async () => {
    // Em `AGUARDANDO_PAGAMENTO` não há data, e ela é a afirmação de quando o dinheiro saiu — não se
    // digita de passagem. Ali o botão da linha some e o «Confirmar» do modal volta.
    responder({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null });
    await montar();
    expect(screen.queryByRole("button", { name: "Lançar" })).toBeNull();
    expect(botao("Confirmar")).toBeInTheDocument();
  });

  it("⚠ sem conta o botão fica VISÍVEL e desabilitado, com o motivo — nunca some", async () => {
    responder({ contaSugerida: null, sugestao: null });
    await montar();
    expect(botao("Lançar")).toBeDisabled();
    expect(botao("Lançar")).toHaveAttribute("title", expect.stringMatching(/conta/i));
  });
});

describe("⚠⚠⚠ «Fluxo» — libera no fluxo e NÃO lança", () => {
  it("⚠⚠ pôr no fluxo NÃO chama a rota de ação — não toca no razão", async () => {
    await montar();
    await clicar("Pôr no fluxo");
    expect(mockPostFluxo).toHaveBeenCalledWith("emp-1", "dec-1", {});
    expect(mockPostAcao).not.toHaveBeenCalled();
  });

  it("⚠⚠ e o corpo vai VAZIO — é isso que faz o servidor usar a EMISSÃO da nota", async () => {
    // Escolha do dono: *"na data da emissão mais o contador pode alterar"*.
    await montar();
    await clicar("Pôr no fluxo");
    expect(mockPostFluxo.mock.calls[0][2]).toEqual({});
  });

  it("⚠⚠ já no fluxo, o botão diz TIRAR e manda `data: null`", async () => {
    // ⚠ É o caso que mais engana: com `{ data: data || undefined }` o `null` viraria `undefined`,
    // que significa "use a emissão" — e o clique de REMOVER reinseriria a linha.
    responder({ previstoNoFluxoEm: "2026-07-02" });
    await montar();
    await clicar("Tirar do fluxo");
    expect(mockPostFluxo).toHaveBeenCalledWith("emp-1", "dec-1", { data: null });
  });

  it("⚠ a data em que ela está no fluxo sai VISÍVEL, não em `title`", async () => {
    // `title` não aparece no teclado nem no toque — a regra escrita duas vezes no CLAUDE.md do app.
    responder({ previstoNoFluxoEm: "2026-07-02" });
    await montar();
    expect(screen.getByText(/no fluxo em 02\/07\/2026/i)).toBeInTheDocument();
  });

  it("⚠ linha JÁ LANÇADA não oferece o botão — o lançamento dela já é linha do fluxo", async () => {
    // Oferecê-lo poria o mesmo dinheiro duas vezes na tela do cliente: uma como fato, outra como
    // previsão. O servidor recusa; a tela não propõe.
    responder({ estado: "CONTABILIZADO", accountingEntryId: "ae-1" });
    await montar();
    expect(screen.queryByRole("button", { name: /no fluxo/i })).toBeNull();
  });

  it("⚠ e a RECUSADA também não — diria o contrário do que o contador decidiu", async () => {
    responder({ estado: "RECUSADO", motivoRecusa: "não é despesa da empresa" });
    await montar();
    expect(screen.queryByRole("button", { name: /no fluxo/i })).toBeNull();
  });
});
