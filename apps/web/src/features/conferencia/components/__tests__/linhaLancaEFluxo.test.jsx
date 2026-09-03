// ⚠⚠⚠ A LINHA GANHOU CONTA, «LANÇAR» E «FLUXO» — decisão do dono, 01/09/2026.
//
// > *"tudo que vem da nota vem em uma única linha, nessa linha podemos adicionar a conta e lançar,
// > ao lançar entra no fluxo. temos um botão fluxo, que apenas libera no fluxo mas não lança."*
//
// Antes disto a conta só existia dentro do modal: lançar uma despesa era abrir uma caixa, escolher
// e confirmar, uma por uma. E não havia como pôr uma despesa no fluxo sem levá-la ao razão.
//
// ⚠ O que este arquivo trava, em ordem de custo:
//   1. lançar da linha usa a MESMA rota e a MESMA ação do modal — nunca um segundo verbo;
//   2. a tela manda o `codigoCompleto`, nunca o reduzido que o contador digita;
//   3. a linha não voltar a ter dois botões para o mesmo ato;
//   4. o botão «Fluxo» não voltar — a regra de 01/09/2026 o tornou sem sentido.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetFila = jest.fn();
const mockGetPlano = jest.fn();
const mockPostAcao = jest.fn();
const mockGetPendencias = jest.fn();
const mockGetCasamentos = jest.fn();

jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getConferenciaFila: (...a) => mockGetFila(...a),
    postConferenciaAcao: (...a) => mockPostAcao(...a),
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

  it("⚠⚠ quando a ação pede DATA, a data se digita NA LINHA — o modal deixou de ser o caminho (02/09/2026)", async () => {
    // ⚠⚠ ESTE TESTE AFIRMAVA O CONTRÁRIO ("o caminho volta a ser o modal") até 02/09/2026, e o
    // argumento era que a data *"não se digita de passagem"*. O dono decidiu: *"cada linha deve
    // conter data, crédito e débito, todos modificáveis inline"*. O que ficou do argumento antigo
    // é a MARCA: a data digitada sai em âmbar como "declaração sua", nunca parecendo prova.
    responder({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null });
    await montar();
    expect(screen.getByRole("button", { name: "Lançar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    const data = screen.getByLabelText(/Data do pagamento de GOOGLE CLOUD BRASIL/i);
    // nasce com a EMISSÃO (`dataDocumento`), nunca com hoje
    expect(data).toHaveValue("2026-07-02");
    expect(screen.getByText("declaração sua")).toBeInTheDocument();
  });

  it("⚠⚠ data PROVADA pelo extrato NÃO vira campo — a prova não se rebaixa num clique", async () => {
    // A linha padrão deste arquivo tem `origemPagamento: "OFX"`: evidência do banco.
    await montar();
    expect(screen.queryByLabelText(/Data do pagamento de GOOGLE CLOUD BRASIL/i)).toBeNull();
    expect(screen.getByText("15/07/2026")).toBeInTheDocument();
  });

  it("⚠ sem conta o botão fica VISÍVEL e desabilitado, com o motivo — nunca some", async () => {
    responder({ contaSugerida: null, sugestao: null });
    await montar();
    expect(botao("Lançar")).toBeDisabled();
    expect(botao("Lançar")).toHaveAttribute("title", expect.stringMatching(/conta/i));
  });
});

describe("⚠⚠⚠ O BOTÃO «FLUXO» FOI REMOVIDO — a regra nova o tornou sem sentido", () => {
  // ⚠⚠ ELE NASCEU E MORREU EM 01/09/2026, as duas por decisão do dono. Ele punha a despesa no fluxo
  // do cliente SEM lançar; horas depois veio a regra que o matou: *"só entra no fluxo aquilo que
  // for lançado, ou seja as saídas do fluxo são as despesas lançadas"*.
  //
  // ⚠ Não é um botão que sumiu — é a PERGUNTA que ele respondia que deixou de ser feita. Este bloco
  // fica para ninguém o reintroduzir achando que foi esquecimento.

  it("a linha não oferece mais pôr nem tirar do fluxo", async () => {
    await montar();
    expect(screen.queryByRole("button", { name: /no fluxo/i })).toBeNull();
  });

  it("⚠ nem quando a linha traz a coluna morta preenchida — não há leitor dela", async () => {
    // ⚠ `previstoNoFluxoEm` foi APAGADA do banco em 02/09/2026. O caso FICA: ele prova que a TELA
    // ignora o campo — e um payload antigo, de um cliente que não recarregou, ainda pode trazê-lo.
    responder({ previstoNoFluxoEm: "2026-07-02" });
    await montar();
    expect(screen.queryByRole("button", { name: /no fluxo/i })).toBeNull();
    expect(screen.queryByText(/no fluxo em/i)).toBeNull();
  });

  it("⚠⚠ e o que entra no fluxo agora é o LANÇAMENTO — o «Lançar» continua inteiro", async () => {
    // A regra nova não removeu caminho nenhum: ela disse que o fluxo é exatamente o que foi lançado.
    await montar();
    await waitFor(() => expect(campoDaConta()).toHaveValue("401"));
    expect(botao("Lançar")).not.toBeDisabled();
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


// -------------------------------------------------------------------------------------------------
// ⚠⚠ A CONTA DE CRÉDITO NO MODAL (01/09/2026) — dono: *"aqueles que viram lançamento contábil devem
// ter opção de colocar débito e crédito, por mais que sempre seja 5, pode haver a possibilidade de
// ser compra de ativo, ou outra coisa"*.
//
// ⚠⚠ O QUE ESTE BLOCO PROTEGE É A DISTINÇÃO ENTRE «NÃO ESCOLHI» E «APAGUEI A ESCOLHA». Mandar
// `contaCredito: null` sempre que o campo estivesse vazio APAGARIA, a cada confirmação, o crédito
// que a regra do fornecedor escolheu — inclusive pelo botão «Lançar» da linha, que não tem campo de
// crédito nenhum.
// -------------------------------------------------------------------------------------------------


// -------------------------------------------------------------------------------------------------
// ⚠⚠ O SELETOR DE CRÉDITO NO MODAL — a tela recusando o que o servidor recusaria.
// -------------------------------------------------------------------------------------------------
describe("⚠⚠ o CRÉDITO na própria linha — o «Contas…» saiu, o campo desceu (02/09/2026)", () => {
  const CONTAS = [
    { codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ", analitica: true },
    { codigo: "12", codigoCompleto: "111020001", nome: "BANCO ITAU", analitica: true },
    { codigo: "300", codigoCompleto: "211010001", nome: "FORNECEDORES A PAGAR", analitica: true },
    { codigo: "464", codigoCompleto: "411020008", nome: "SERVICOS PJ", analitica: true },
  ];

  const abrir = async (item = {}) => {
    mockGetFila.mockResolvedValue({
      itens: [{
        id: "d-1", estado: "A_CONFERIR", origem: "NOTA_RECEBIDA", valor: "1500.00",
        descricaoOriginal: "GOOGLE CLOUD", competencia: "2026-07",
        dataPagamento: "2026-07-15", origemPagamento: "OFX",
        contaSugerida: "411020008", contaCredito: null, ...item,
      }],
      total: 1, resumo: {},
    });
    mockGetPlano.mockResolvedValue(CONTAS);
    render(<ConferenciaTab companyId="emp-1" competencia="2026-07" podeEscrever />);
    // ⚠ O «Contas…» de 01/09 SAIU: o crédito virou campo da linha (dono, 02/09: *"data, crédito e
    // débito, todos modificáveis inline"*). Espera o plano chegar antes de medir.
    await screen.findByLabelText(/Conta de crédito de GOOGLE CLOUD/i);
    await waitFor(() => expect(document.querySelectorAll("#creditos-da-conferencia option").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /^Contas…$/ })).toBeNull();
    return document.body;
  };
  const campoDoCredito = () => screen.getByLabelText(/Conta de crédito de GOOGLE CLOUD/i);
  const lancar = () => screen.getByRole("button", { name: /^Lançar$/i });

  it("⚠⚠ o campo existe, nasce VAZIO e DIZ que o padrão é o caixa", async () => {
    // ⚠ Preenchê-lo com "5" apagaria a distinção que a coluna guarda: "é caixa porque escolheram" ×
    // "é caixa por padrão".
    await abrir();
    expect(campoDoCredito()).toHaveValue("");
    expect(campoDoCredito()).toHaveAttribute("placeholder", expect.stringMatching(/vazio = caixa/i));
  });

  it("⚠⚠⚠ crédito que NÃO é disponibilidade trava o envio, com o motivo VISÍVEL", async () => {
    // ⚠⚠ A invariante do caixa: o lançamento AFIRMA que o dinheiro saiu. Creditando fornecedores
    // ele seria válido no razão e mentiria no caixa. ⚠ E o motivo sai em TEXTO na linha, não só no
    // `title` — `title` não aparece no teclado nem no toque.
    await abrir();
    fireEvent.change(campoDoCredito(), { target: { value: "300" } });
    expect(await screen.findByText(/sai de caixa ou banco/i)).toBeInTheDocument();
    expect(lancar()).toBeDisabled();
    expect(lancar()).toHaveAttribute("title", expect.stringMatching(/caixa ou banco/i));
  });

  it("⚠⚠ o banco é aceito, e a linha DIZ o nome da conta escolhida", async () => {
    // ⚠ Código sozinho não se confere: o nome sai sob o campo. E o «Lançar» fica habilitado — o
    // crédito escolhido é disponibilidade, e o débito já veio da sugestão.
    await abrir();
    fireEvent.change(campoDoCredito(), { target: { value: "12" } });
    // ⚠ `getAllByText` filtrando `<option>`: o nome também está na lista do `datalist`.
    const nomes = (await screen.findAllByText("BANCO ITAU")).filter((n) => n.tagName !== "OPTION");
    expect(nomes.length).toBeGreaterThan(0);
    await waitFor(() => expect(lancar()).toBeEnabled());
  });

  it("⚠⚠ e o crédito escolhido VIAJA no clique — como `codigoCompleto`", async () => {
    await abrir();
    fireEvent.change(campoDoCredito(), { target: { value: "12" } });
    await waitFor(() => expect(lancar()).toBeEnabled());
    fireEvent.click(lancar());
    await waitFor(() => expect(mockPostAcao).toHaveBeenCalled());
    expect(mockPostAcao.mock.calls[0][3]).toMatchObject({ contaCredito: "111020001" });
  });

  it("⚠⚠ a escolha JÁ FEITA volta no campo — em reduzido, que é o que o contador lê", async () => {
    // Sem isto, reabrir a linha mostraria o campo vazio: "não há crédito escolhido", o oposto da
    // verdade. É o caso da linha que a REGRA do fornecedor lançou com crédito próprio.
    await abrir({ contaCredito: "111020001" });
    await waitFor(() => expect(campoDoCredito()).toHaveValue("12"));
  });

  it("⚠⚠ o crédito que a REGRA sugere já vem preenchido — «as regras já devem habilitar»", async () => {
    // ⚠ É a metade do pedido do dono que faltava: a regra tem DUAS contas desde 29/08, e a linha só
    // pré-preenchia o débito. Agora `sugestao.credito` chega e o campo nasce com ele.
    await abrir({ sugestao: { conta: "411020008", credito: "111020001", procedencia: "REGRA_CNPJ" } });
    await waitFor(() => expect(campoDoCredito()).toHaveValue("12"));
  });

  it("⚠ a lista oferecida NÃO tem conta de despesa — só disponibilidade", async () => {
    await abrir();
    // ⚠ O `datalist` mora na ABA (um só, para linha e modal oferecerem a MESMA lista).
    const lista = document.querySelector("#creditos-da-conferencia");
    const codigos = [...lista.querySelectorAll("option")].map((o) => o.value);
    expect(codigos).toEqual(expect.arrayContaining(["5", "12"]));
    expect(codigos).not.toContain("464");
    expect(codigos).not.toContain("300");
  });
});

describe("⚠⚠ o CRÉDITO no corpo do ato — `montarCorpo`", () => {
  const { montarCorpo } = require("../renderConferenciaTab");
  const { ACAO } = require("../../lib/conferenciaTela");

  const cfg = ACAO.confirmar;
  const item = { id: "d-1", valor: 1500, dataPagamento: "2026-07-15", origemPagamento: "OFX", sugestao: { conta: "411020008" } };
  const base = { acao: "confirmar", item, data: "2026-07-15", motivo: "", valor: "", cfg, contaCompleta: "411020008" };

  it("⚠⚠ com escolha, o crédito VIAJA", () => {
    const corpo = montarCorpo({ ...base, creditoCompleto: "111020001", creditoTocado: true });
    expect(corpo.contaCredito).toBe("111020001");
  });

  it("⚠⚠⚠ SEM ESCOLHA e sem toque, a chave NEM APARECE — o que estava fica", () => {
    // ⚠⚠ É o caso do botão «Lançar» da linha, que não tem campo de crédito: mandar `null` ali
    // apagaria em silêncio o crédito que a regra do fornecedor escolheu.
    const corpo = montarCorpo({ ...base, item: { ...item, contaCredito: "111020001" } });
    expect(Object.prototype.hasOwnProperty.call(corpo, "contaCredito")).toBe(false);
  });

  it("⚠⚠ campo LIMPO por quem tinha escolha manda `null` — é como se desfaz", () => {
    const corpo = montarCorpo({
      ...base, item: { ...item, contaCredito: "111020001" }, creditoCompleto: null, creditoTocado: true,
    });
    expect(corpo.contaCredito).toBeNull();
  });

  it("⚠ campo vazio em quem NUNCA teve escolha não manda nada — não há o que desfazer", () => {
    const corpo = montarCorpo({ ...base, creditoCompleto: null, creditoTocado: true });
    expect(Object.prototype.hasOwnProperty.call(corpo, "contaCredito")).toBe(false);
  });

  it("⚠ ação que NÃO cria lançamento nunca leva crédito", () => {
    const corpo = montarCorpo({
      ...base, acao: "recusar", cfg: ACAO.recusar, motivo: "nao e despesa",
      creditoCompleto: "111020001", creditoTocado: true,
    });
    expect(corpo.contaCredito).toBeUndefined();
  });
});
