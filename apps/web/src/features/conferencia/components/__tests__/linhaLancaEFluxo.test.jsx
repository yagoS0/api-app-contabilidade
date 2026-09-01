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
//   4. a linha não voltar a ter dois botões para o mesmo ato.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetFila = jest.fn();
const mockGetPlano = jest.fn();
const mockPostAcao = jest.fn();
const mockPostFluxo = jest.fn();
const mockGetPendencias = jest.fn();
const mockGetCasamentos = jest.fn();

jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getConferenciaFila: (...a) => mockGetFila(...a),
    postConferenciaAcao: (...a) => mockPostAcao(...a),
    postConferenciaFluxo: (...a) => mockPostFluxo(...a),
    getChartOfAccounts: (...a) => mockGetPlano(...a),
    getConferenciaPendencias: (...a) => mockGetPendencias(...a),
    getConferenciaCasamentos: (...a) => mockGetCasamentos(...a),
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
  // ⚠ Vazio por padrão: sem casamento nenhum, o bloqueio da despesa em dobro não morde.
  mockGetCasamentos.mockResolvedValue({ ok: true, linhas: [] });
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
    // ⚠⚠ `contaAplicada`, NUNCA `conta`: é a chave que o servidor lê (`routes/firm/conferencia.js`).
    // A primeira versão deste caminho mandava `conta` e a conta era ignorada EM SILÊNCIO — o
    // lançamento recusaria por falta dela, e este teste passava afirmando a chave errada.
    expect(mockPostAcao).toHaveBeenCalledWith("emp-1", "dec-1", "confirmar", { contaAplicada: "411020001" });
  });

  it("⚠⚠ e NÃO abre modal — era o clique a mais que o dono pediu para tirar", async () => {
    await montar();
    await waitFor(() => expect(campoDaConta()).toHaveValue("401"));
    await clicar("Lançar");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("⚠⚠ UM botão só para o ato — o «Confirmar» duplicado saiu (dono, 01/09/2026)", async () => {
    // ⚠⚠ ESTE TESTE AFIRMAVA O CONTRÁRIO por algumas horas, registrando a dívida: a linha tinha
    // "Lançar" E "Confirmar", e o contador teria de descobrir por tentativa qual dos dois usava a
    // conta que ele acabou de digitar ao lado. O dono mandou tirar, e os ~15 casos de
    // `conferenciaNaTela.ligacao.test.jsx` que alcançavam o modal por ele foram migrados um a um
    // para a ação que AINDA pede modal (a que pede data) — nenhuma garantia foi descartada.
    await montar();
    expect(screen.getByRole("button", { name: "Lançar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
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

describe("⚠⚠⚠ A DESPESA EM DOBRO — a guarda que faltava na LINHA (01/09/2026)", () => {
  // Um débito de extrato que é o PAGAMENTO de uma nota da fila não pode ser contabilizado à parte:
  // a nota vira um lançamento e o débito vira outro, para o mesmo dinheiro que saiu uma vez.
  //
  // ⚠⚠ O LOTE JÁ SE PROTEGIA (`abrirLote` recusa abrir sem esta resposta) e a LINHA NÃO — nem
  // antes: o «Confirmar» do modal também nunca consultou. O «Lançar» só tirou o modal do caminho.
  //
  // ⚠⚠ **ESTE BLOCO JÁ NASCEU ERRADO UMA VEZ, e a lição vale mais que ele.** A primeira versão
  // afirmava só `toBeDisabled()`. O botão nasce desabilitado por OUTRO motivo — *"escolha a conta"*,
  // enquanto o plano de contas não chegou — então o `waitFor` passava no primeiro render e o teste
  // nunca alcançava o estado que dizia medir. Desligando a guarda, ele continuava verde.
  // Agora cada caso espera a conta RESOLVER e afirma o MOTIVO, nunca o `disabled` sozinho.

  // ⚠ A descrição fica a mesma do resto do arquivo de propósito: o `montar()` espera por ela, e o
  // que está sob teste é a ORIGEM (extrato) e o casamento — não o texto.
  const DEBITO = { ...LINHA, id: "dec-9", origem: "OFX_CLIENTE" };

  const casamentoCom = (linhas) => mockGetCasamentos.mockResolvedValue({ ok: true, linhas });

  const casaComNota = [{
    debito: { id: "dec-9", descricaoOriginal: "GOOGLE CLOUD BRASIL", valor: "890.00" },
    sugestao: { nota: { id: "dec-2", descricaoOriginal: "KODA BEAR", valor: "890.00" } },
    candidatos: [],
  }];

  /**
   * ⚠⚠ ESPERA A CONTA RESOLVER antes de olhar o botão. Sem isto, todo caso mede o bloqueio de
   * "sem conta" achando que mede o de despesa em dobro.
   */
  const montarComConta = async () => {
    await montar();
    await waitFor(() => expect(campoDaConta()).toHaveValue("401"));
  };

  const motivoDoBotao = () => botao("Lançar").getAttribute("title");

  it("⚠⚠ débito que JÁ CASA com uma nota é bloqueado PELO MOTIVO CERTO", async () => {
    responder(DEBITO);
    casamentoCom(casaComNota);
    await montarComConta();
    await waitFor(() => expect(motivoDoBotao()).toMatch(/duas vezes/i));
    expect(botao("Lançar")).toBeDisabled();
  });

  it("⚠⚠ e o motivo sai VISÍVEL, não só no `title` — é o único bloqueio que erra DINHEIRO", async () => {
    // `title` não aparece no teclado nem no toque, e a regra da casa o recusa como via única.
    responder(DEBITO);
    casamentoCom(casaComNota);
    await montarComConta();
    await waitFor(() => expect(screen.getByText(/lançaria a mesma despesa duas vezes/i)).toBeInTheDocument());
  });

  it("⚠ e ele diz O QUE FAZER — casar com a nota no painel acima", async () => {
    responder(DEBITO);
    casamentoCom(casaComNota);
    await montarComConta();
    await waitFor(() => expect(screen.getByText(/case-o com a nota no painel acima/i)).toBeInTheDocument());
  });

  it("⚠⚠ nota JÁ CONTABILIZADA tem frase PRÓPRIA — o conserto é outro", async () => {
    // Ali não há o que casar: o caminho é desfazer e refazer. Com uma frase só, a tela mandaria
    // casar num painel que diz, ao lado, que não há o que casar.
    responder(DEBITO);
    casamentoCom([{
      debito: { id: "dec-9", descricaoOriginal: "GOOGLE CLOUD BRASIL", valor: "890.00" },
      sugestao: { nota: { id: "dec-2" }, podeFundir: false },
      candidatos: [{ nota: { id: "dec-2" }, podeFundir: false }],
    }]);
    await montarComConta();
    await waitFor(() => expect(screen.getByText(/JÁ contabilizou/i)).toBeInTheDocument());
    expect(screen.queryByText(/case-o com a nota no painel acima/i)).toBeNull();
  });

  it("⚠⚠ débito que NÃO casa com nada fica LANÇÁVEL — a guarda não pode travar o trabalho", async () => {
    responder(DEBITO);
    casamentoCom([{
      debito: { id: "outro-debito", descricaoOriginal: "TARIFA", valor: "12.00" },
      sugestao: null,
      candidatos: [],
    }]);
    await montarComConta();
    await waitFor(() => expect(botao("Lançar")).not.toBeDisabled());
  });

  it("⚠⚠ SEM A RESPOSTA, o débito de extrato BLOQUEIA — a mesma postura do lote", async () => {
    // `abrirLote` RECUSA abrir sem saber quais casam. Na dúvida, não se contabiliza.
    responder(DEBITO);
    mockGetCasamentos.mockRejectedValue(new Error("rede fora"));
    await montarComConta();
    await waitFor(() => expect(motivoDoBotao()).toMatch(/não foi possível conferir/i));
    expect(screen.getByText(/não foi possível conferir/i)).toBeInTheDocument();
  });

  it("⚠⚠ mas a linha de NOTA continua lançável mesmo sem a resposta", async () => {
    // Só o que nasceu de EXTRATO pode ser o pagamento de uma nota. Bloquear a fila inteira por uma
    // falha de rede pararia o trabalho que não corre risco nenhum.
    responder({ origem: "NOTA_RECEBIDA" });
    mockGetCasamentos.mockRejectedValue(new Error("rede fora"));
    await montarComConta();
    await waitFor(() => expect(botao("Lançar")).not.toBeDisabled());
  });

  it("⚠ o extrato em PLANILHA conta igual ao OFX — as duas origens vêm do banco", async () => {
    responder({ ...DEBITO, origem: "EXTRATO_EXCEL_CLIENTE" });
    mockGetCasamentos.mockRejectedValue(new Error("rede fora"));
    await montarComConta();
    await waitFor(() => expect(motivoDoBotao()).toMatch(/não foi possível conferir/i));
  });

  it("⚠⚠ a consulta é UMA só — a fila usa a resposta do painel, não uma segunda", async () => {
    // Duas leituras do mesmo endpoint na mesma tela divergem no instante em que uma recarrega e a
    // outra não, e a que a fila usasse seria a que ninguém confere.
    responder(DEBITO);
    casamentoCom(casaComNota);
    await montarComConta();
    await waitFor(() => expect(mockGetCasamentos).toHaveBeenCalled());
    expect(mockGetCasamentos).toHaveBeenCalledTimes(1);
  });
});
