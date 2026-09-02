// ⚠⚠ A TELA "A LANÇAR", SEPARADA POR NATUREZA — o DOM conferido contra a regra.
//
// > Dono: *"na página A lançar, separe visualmente o que são regras, saídas do cliente, o que é
// > para virar lançamento e o que é para o fluxo."*
//
// A tela tinha SEIS painéis mais a fila, todos com o MESMO cartão neutro, num `grid` sem um único
// título — nada dizia que confirmar numa caixa cria lançamento contábil e na caixa vizinha não cria
// nada. As seções são montadas em JSX à mão (os painéis recebem props diferentes), então o que
// impede a tela de divergir da regra é ESTE arquivo: ele lê `natureza(bloco)` de
// `lib/naturezaDaConferencia.js` e exige que cada painel esteja sob o título que ela manda.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetFila = jest.fn();
const mockGetPlano = jest.fn();
const mockGetCasamentos = jest.fn();
const mockGetLancados = jest.fn();
const mockGetRegras = jest.fn();
const mockGetRecorrencias = jest.fn();
const mockGetSaidas = jest.fn();
const mockGetMexidas = jest.fn();
const mockGetPendencias = jest.fn();
const mockGetAutomacao = jest.fn();
const mockDeleteAutomacao = jest.fn();
const mockPostAutomatica = jest.fn(async () => ({
  ok: true, ligada: true, desde: "2026-07-01",
  varridas: 18, criados: 12, jaExistiam: 4, fora: [], recusados: [],
}));

// ⚠ Delegação, nunca referência direta: o `jest.mock` é hoisted e os painéis chamam
// `createApiClient()` no corpo do módulo — tocar nos dublês aqui estoura no TDZ. Mesmo desenho do
// `conferenciaNaTela.ligacao.test.jsx`.
jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getConferenciaFila: (...a) => mockGetFila(...a),
    postConferenciaAcao: jest.fn(),
    getChartOfAccounts: (...a) => mockGetPlano(...a),
    getConferenciaCasamentos: (...a) => mockGetCasamentos(...a),
    getLancadosPorRegra: (...a) => mockGetLancados(...a),
    getConferenciaRegras: (...a) => mockGetRegras(...a),
    getRecorrencias: (...a) => mockGetRecorrencias(...a),
    getConferenciaSaidasDoCliente: (...a) => mockGetSaidas(...a),
    getConferenciaMexidasDoCliente: (...a) => mockGetMexidas(...a),
    getConferenciaPendencias: (...a) => mockGetPendencias(...a),
    getVarreduraAutomatica: (...a) => mockGetAutomacao(...a),
    postVarreduraAutomatica: (...a) => mockPostAutomatica(...a),
    postVarrerNotas: jest.fn(async () => ({ ok: true, varridas: 0, criados: 0, jaExistiam: 0, fora: [], recusados: [] })),
    deleteVarreduraAutomatica: (...a) => mockDeleteAutomacao(...a),
  }),
}));

import { ConferenciaTab } from "../renderConferenciaTab";
import { BLOCO, NATUREZA, SECAO, natureza } from "../../lib/naturezaDaConferencia";

// ⚠⚠ TODOS OS SEIS PAINÉIS PRECISAM RENDERIZAR, e quatro deles somem sozinhos quando não há nada a
// decidir. Sem alimentar cada um, este arquivo mediria a colocação de dois painéis e passaria verde
// sobre uma tela em que os outros quatro estivessem na seção errada.
const LINHA = {
  id: "dec-1",
  origem: "CLIENTE_MANUAL",
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
  contaSugerida: "411030012",
  sugestao: null,
  nota: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFila.mockResolvedValue({ ok: true, itens: [LINHA], porEstado: {}, total: 1 });
  mockGetPlano.mockResolvedValue([
    { codigo: "5", codigoCompleto: "111010001", nome: "Caixa", analitica: true },
    { codigo: "557", codigoCompleto: "411030012", nome: "Despesas com Software", analitica: true },
  ]);
  mockGetCasamentos.mockResolvedValue({
    ok: true,
    totalDebitos: 1,
    totalNotas: 1,
    linhas: [{
      debito: {
        id: "ofx-1",
        descricaoOriginal: "PAGTO FORNECEDOR",
        valor: "890.00",
        dataPagamento: "2026-07-18",
        cnpjFornecedor: null,
      },
      sugestao: null,
      candidatos: [],
      motivo: "nenhum_candidato",
      frase: "Nenhuma nota recebida em aberto se parece com este débito.",
    }],
  });
  mockGetLancados.mockResolvedValue({
    ok: true, indisponivel: false, competencia: "2026-07", total: 1, valor: 1180,
    linhas: [{
      id: "dec-r1", descricaoOriginal: "ALESSANDRO NIGRO", cnpjFornecedor: "12345678000190",
      valor: "1180.00", valorAjustado: null, competencia: "2026-07",
      dataPagamento: "2026-07-15", contaAplicada: "411030012", accountingEntryId: "ae-r1",
    }],
  });
  mockGetRegras.mockResolvedValue({
    ok: true, indisponivel: false,
    regras: [{
      id: "reg-1", ativa: true, cnpjFornecedor: "12345678000190", padraoDescricao: null,
      valorMin: "1050.00", valorMax: "1180.00", contaDestino: "411030012", contaCredito: "111010001",
      lancaSozinha: false, diaDoLancamento: null, aplicacoes: 3,
    }],
  });
  mockGetRecorrencias.mockResolvedValue({
    ok: true,
    series: [{
      lado: "DESPESA", chave: "98765432000155", rotulo: "ANTHROPIC", periodicidade: "MENSAL",
      estado: null, origem: null, valorDeclarado: null, leitura: "sugere_entrada",
      valorProjetado: 130, base: { n: 3, min: 120, max: 140, cv: 0.08 },
    }],
  });
  mockGetSaidas.mockResolvedValue({
    ok: true, indisponivel: false,
    saidas: [{ id: "sa-1", data: "2026-09-18", valor: "3500.00", descricao: "Reforma da sala", estado: "PENDENTE" }],
  });
  // ⚠ `indisponivel` basta para o painel desenhar, e evita inventar a forma de uma mexida — que
  // este arquivo não mediu. Ele mede COLOCAÇÃO, não o conteúdo daquele painel.
  mockGetMexidas.mockResolvedValue({ ok: true, indisponivel: true, mexidas: [] });
  mockGetPendencias.mockResolvedValue({ ok: true, declaradosForaDaCompetencia: 0 });
});

const montar = async () => {
  const r = render(<ConferenciaTab companyId="emp-1" competencia="2026-07" />);
  // ⚠ `getAllBy`: o nome do fornecedor sai DUAS vezes na fila — no cabeçalho do grupo e na
  // descrição da linha. É o agrupamento por fornecedor funcionando, não duplicata.
  await waitFor(() => expect(screen.getAllByText("GOOGLE CLOUD BRASIL").length).toBeGreaterThan(0));
  return r;
};

/** A região da seção de uma natureza — `<section aria-label>` expõe `role="region"`. */
const secaoDe = (nat) => screen.getByRole("region", { name: SECAO[nat].titulo });

describe("⚠⚠ as três seções existem, com título e com a frase que diz o que o clique faz", () => {
  it("as três aparecem", async () => {
    await montar();
    for (const nat of [NATUREZA.VIRA_LANCAMENTO, NATUREZA.SO_FLUXO, NATUREZA.REGRA]) {
      expect(secaoDe(nat)).toBeInTheDocument();
      expect(within(secaoDe(nat)).getByText(SECAO[nat].frase)).toBeInTheDocument();
    }
  });

  it("⚠ nesta ordem: vira lançamento → só fluxo → regras", async () => {
    const { container } = await montar();
    const rotulos = [...container.querySelectorAll("section[aria-label]")]
      .map((s) => s.getAttribute("aria-label"));
    expect(rotulos).toEqual([
      SECAO[NATUREZA.VIRA_LANCAMENTO].titulo,
      SECAO[NATUREZA.SO_FLUXO].titulo,
      SECAO[NATUREZA.REGRA].titulo,
    ]);
  });

  it("⚠ a frase vai no CORPO, não em `title` — ela diz se o clique mexe na contabilidade", async () => {
    // `title` não aparece no teclado nem no toque; é a mesma decisão do aviso da aba Notas Fiscais.
    await montar();
    expect(screen.getByText(SECAO[NATUREZA.VIRA_LANCAMENTO].frase)).toBeVisible();
    expect(screen.getByText(SECAO[NATUREZA.SO_FLUXO].frase)).toBeVisible();
  });
});

describe("⚠⚠ cada painel sob a seção que a REGRA manda — o DOM conferido contra `natureza()`", () => {
  // ⚠ O bloco e o texto que o identifica na tela. Se a tela mover um painel de seção, o `within`
  // falha; se a regra mudar, o esperado muda junto — que é o ponto de ler `natureza()` aqui.
  const ONDE_APARECE = [
    [BLOCO.CASAMENTOS, "Débitos do extrato sem nota vinculada"],
    [BLOCO.FILA, "GOOGLE CLOUD BRASIL"],
    [BLOCO.LANCADOS_POR_REGRA, /Lançados por regra/],
    [BLOCO.RECORRENCIAS, "Recorrências"],
    [BLOCO.SAIDAS_DO_CLIENTE, "Saídas que o cliente acrescentou"],
    [BLOCO.REGRAS, "Regras do fornecedor"],
  ];

  it.each(ONDE_APARECE)("%s aparece dentro da seção dele", async (bloco, texto) => {
    await montar();
    expect(within(secaoDe(natureza(bloco))).getAllByText(texto).length).toBeGreaterThan(0);
  });

  it("⚠⚠⚠ o extrato «lançados por regra» está na seção REGRAS, e RECOLHIDO", async () => {
    // ⚠⚠ ELE FOI E VOLTOU NO MESMO DIA: virou aba própria e o dono a devolveu — *"devolva a aba
    // pras regras"*. A causa ao lado da consequência era o argumento da posição original.
    // ⚠ RECOLHIDO porque é CIÊNCIA, não tarefa: ninguém espera decisão dele, e aberto empurraria
    // para baixo o que pede ação.
    await montar();
    const secao = secaoDe(NATUREZA.REGRA);
    const resumo = within(secao).getByText(/Lançados por regra/);
    expect(resumo.closest("details")).not.toBeNull();
    expect(resumo.closest("details").open).toBe(false);
  });

  it("⚠ o resumo diz se vale a pena abrir — contagem, valor e quantos estão SEM NOTA", async () => {
    // Um "Lançados por regra" mudo não informa nada, e o custo de abrir é a rolagem que o
    // recolhimento existe para poupar.
    await montar();
    const sumario = within(secaoDe(NATUREZA.REGRA)).getByText(/Lançados por regra/).closest("summary");
    expect(sumario.textContent).toMatch(/1 lançamento/);
  });

  it("⚠ o sexto painel (mexidas do cliente) também — ele não pede nada e é o que se esquece", async () => {
    await montar();
    const secao = secaoDe(natureza(BLOCO.MEXIDAS_DO_CLIENTE));
    expect(secao.querySelector("[data-teste=mexidas-do-cliente]")).not.toBeNull();
  });

  it("⚠⚠ RECORRÊNCIA NÃO está na seção que lança — é previsão de fluxo, não despesa contabilizada", async () => {
    await montar();
    expect(within(secaoDe(NATUREZA.VIRA_LANCAMENTO)).queryByText("Recorrências")).toBeNull();
  });

  it("⚠⚠ e a FILA não está na seção do fluxo — é ela que vira lançamento", async () => {
    await montar();
    expect(within(secaoDe(NATUREZA.SO_FLUXO)).queryAllByText("GOOGLE CLOUD BRASIL")).toHaveLength(0);
  });
});

describe("⚠⚠ a fronteira do caixa: vocabulário contábil NÃO entra no cabeçalho do fluxo", () => {
  it("nem no título, nem na frase", async () => {
    // Guardião irmão do `painelDeSaidasDoCliente.test.jsx:52`. Lá ele mede o painel isolado; a
    // seção é justamente o que poderia trazer a palavra "lançamento" para perto daquela fila e
    // fazer o contador procurar uma conta contábil que este caminho não tem.
    await montar();
    const cabecalho = within(secaoDe(NATUREZA.SO_FLUXO)).getByText(SECAO[NATUREZA.SO_FLUXO].titulo);
    expect(cabecalho.parentElement.textContent).not.toMatch(/conta|débito|crédito/i);
  });

  it("⚠ e a seção que LANÇA diz o que o lançamento faz — débito na despesa, crédito no caixa", async () => {
    await montar();
    expect(within(secaoDe(NATUREZA.VIRA_LANCAMENTO)).getByText(/débito na conta da despesa/i))
      .toBeInTheDocument();
  });
});

describe("⚠⚠ a origem da linha — o que responde «saídas do cliente» DENTRO da fila", () => {
  it("a linha do cliente traz o chip `do cliente`", async () => {
    await montar();
    expect(within(secaoDe(NATUREZA.VIRA_LANCAMENTO)).getByText("do cliente")).toBeInTheDocument();
  });

  it("⚠ o chip diz de onde veio, em texto — não é só uma cor", async () => {
    await montar();
    expect(screen.getByText("do cliente")).toHaveAttribute("title", expect.stringMatching(/portal/i));
  });

  it.each([
    ["NOTA_RECEBIDA", "nota recebida"],
    ["OFX_CLIENTE", "extrato (OFX)"],
    ["EXTRATO_EXCEL_CLIENTE", "extrato (planilha)"],
  ])("origem %s vira o chip %s na linha", async (origem, rotulo) => {
    mockGetFila.mockResolvedValue({ ok: true, itens: [{ ...LINHA, origem }], porEstado: {}, total: 1 });
    await montar();
    expect(screen.getByText(rotulo)).toBeInTheDocument();
  });

  it("⚠⚠ origem que a tela não conhece NÃO vira chip com o valor cru do banco", async () => {
    // "ORIGEM_NOVA_DO_BACKEND" na tela do contador é ruído que se parece com informação.
    mockGetFila.mockResolvedValue({
      ok: true, itens: [{ ...LINHA, origem: "ORIGEM_NOVA_DO_BACKEND" }], porEstado: {}, total: 1,
    });
    await montar();
    expect(screen.queryByText(/ORIGEM_NOVA_DO_BACKEND/)).toBeNull();
  });
});

describe("⚠⚠ «19 a lançar» abrindo em 6 — a tela DIZ quantos ficaram fora do mês", () => {
  // > Dono, sobre a ALBATROZ em produção (01/09/2026): *"aparecem 19 a lançar mas ao abrir não
  // > aparece isso tudo"*.
  //
  // O selo do botão conta a fila em QUALQUER mês (decisão deliberada: a nota de julho que ninguém
  // conferiu não pode sumir porque o contador olha agosto). Esta tela abre FILTRADA. Os dois estão
  // certos e falam de populações diferentes — e a diferença se lia como despesa perdida.

  it("⚠⚠ com declarados em outros meses, a tela avisa e diz quantos", async () => {
    mockGetPendencias.mockResolvedValue({ ok: true, declaradosForaDaCompetencia: 13 });
    await montar();
    const secao = secaoDe(NATUREZA.VIRA_LANCAMENTO);
    await waitFor(() => expect(within(secao).getByText(/outras competências/i)).toBeInTheDocument());
    expect(secao.textContent).toMatch(/13/);
  });

  it("⚠ ela pergunta ao servidor PELA competência aberta — senão não haveria o que comparar", async () => {
    await montar();
    await waitFor(() => expect(mockGetPendencias).toHaveBeenCalled());
    expect(mockGetPendencias).toHaveBeenCalledWith("emp-1", { competencia: "2026-07" });
  });

  it("⚠ zero não vira aviso — não há nada fora do mês", async () => {
    mockGetPendencias.mockResolvedValue({ ok: true, declaradosForaDaCompetencia: 0 });
    await montar();
    expect(within(secaoDe(NATUREZA.VIRA_LANCAMENTO)).queryByText(/outras competências/i)).toBeNull();
  });

  it("⚠⚠ AUSÊNCIA também não vira aviso — backend antigo ou falha não inventam um número", async () => {
    // `null` é "não sei quantos", e um aviso sem número seria pior que silêncio. Caminho diferente
    // do zero, mesmo desenho — a regra de sempre desta casa.
    mockGetPendencias.mockResolvedValue({ ok: true });
    await montar();
    expect(within(secaoDe(NATUREZA.VIRA_LANCAMENTO)).queryByText(/outras competências/i)).toBeNull();
  });

  it("⚠ e a contagem que falha não derruba a fila", async () => {
    mockGetPendencias.mockRejectedValue(new Error("rede"));
    await montar();
    expect(within(secaoDe(NATUREZA.VIRA_LANCAMENTO)).getAllByText("GOOGLE CLOUD BRASIL").length)
      .toBeGreaterThan(0);
  });
});


// -------------------------------------------------------------------------------------------------
// ⚠⚠ A LINHA "ESTÃO TRAZENDO AS NOTAS SOZINHO?" — dono, 01/09/2026: *"elas devem ser trazidas
// automaticamente, como tem na aba de notas fiscais deve aparecer ali"*.
//
// ⚠⚠ ELA EXISTE PELO MESMO MOTIVO DO AVISO *"Última busca há 2h…"* DA ABA NOTAS FISCAIS: **sem nota
// na tela, o contador precisa saber se ninguém olhou, se olharam e não veio nada, ou se deu erro.**
// Uma fila vazia não distingue as três — e a diferença entre elas é a diferença entre esperar e ir
// consertar.
// -------------------------------------------------------------------------------------------------
describe("⚠⚠ a Conferência DIZ se as notas estão sendo trazidas sozinho", () => {
  const montarCom = async (automacao) => {
    mockGetAutomacao.mockResolvedValue(automacao);
    const r = render(<ConferenciaTab companyId="emp-1" competencia="2026-07" podeEscrever />);
    await waitFor(() => expect(mockGetAutomacao).toHaveBeenCalledWith("emp-1"));
    return r;
  };

  it("⚠⚠ ligada e sem novidade: a tela DIZ que olhou — não fica muda", async () => {
    await montarCom({
      ok: true, ligada: true, indisponivel: false, desde: "2026-07-01",
      ultimaTentativaEm: "2026-09-02T08:00:00.000Z", ultimoResultadoEm: null,
    });
    expect(await screen.findByText(/última busca não encontrou nota nova/i)).toBeInTheDocument();
  });

  it("⚠⚠ desligada: diz o que fazer, e NÃO se disfarça de erro", async () => {
    await montarCom({ ok: true, ligada: false, indisponivel: false, desde: null });
    expect(await screen.findByText(/não estão sendo trazidas sozinhas/i)).toBeInTheDocument();
    // ⚠ Sem rotina ligada não há o que parar — e um botão que não faz nada é pior que nenhum.
    expect(screen.queryByRole("button", { name: /parar de trazer sozinho/i })).toBeNull();
  });

  it("⚠⚠ ligada: dá a saída, e ela diz que a FILA não é desfeita", async () => {
    // ⚠ "Parar de trazer" se lê facilmente como "tirar o que já veio" — e o que já entrou é fato
    // consumado, com decisões do contador em cima.
    await montarCom({
      ok: true, ligada: true, indisponivel: false, desde: "2026-07-01",
      ultimaTentativaEm: "2026-09-02T08:00:00.000Z", ultimoResultadoEm: "2026-09-02T08:00:00.000Z",
      ultimoCriados: 12,
    });
    const botao = await screen.findByRole("button", { name: /parar de trazer sozinho/i });
    expect(botao).toHaveAttribute("title", expect.stringMatching(/continuam lá/i));
  });

  it("⚠⚠ a falha da consulta vira «não sei», nunca «desligada»", async () => {
    mockGetAutomacao.mockRejectedValue(new Error("500"));
    render(<ConferenciaTab companyId="emp-1" competencia="2026-07" podeEscrever />);
    expect(await screen.findByText(/não foi possível saber/i)).toBeInTheDocument();
  });

  it("⚠⚠⚠ LIGAR pela tela ATUALIZA a linha — sem isso ela NEGA o que a pessoa acabou de fazer", async () => {
    // ⚠⚠ MEDIDO NO NAVEGADOR (01/09/2026): varrer com a caixa marcada ligava a rotina no servidor e
    // a linha continuava dizendo "não estão sendo trazidas sozinhas" até alguém recarregar a
    // página. A tela negava, por escrito, o ato que tinha acabado de acontecer.
    const { default: React } = await import("react");
    mockGetAutomacao.mockResolvedValueOnce({ ok: true, ligada: false, indisponivel: false, desde: null });
    render(<ConferenciaTab companyId="emp-1" competencia="2026-07" podeEscrever />);
    expect(await screen.findByText(/não estão sendo trazidas sozinhas/i)).toBeInTheDocument();

    // a partir daqui o servidor responde LIGADA
    mockGetAutomacao.mockResolvedValue({
      ok: true, ligada: true, indisponivel: false, desde: "2026-07-01",
      ultimaTentativaEm: "2026-09-02T08:00:00.000Z", ultimoResultadoEm: "2026-09-02T08:00:00.000Z",
      ultimoCriados: 12,
    });

    fireEvent.click(screen.getByRole("button", { name: /^Trazer notas$/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText(/a partir de/i), { target: { value: "2026-07-01" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Varrer$/ }));

    await waitFor(() => expect(mockPostAutomatica).toHaveBeenCalledWith("emp-1", "2026-07-01"));
    expect(await screen.findByText(/Trazendo as notas sozinho desde 01\/07\/2026/i)).toBeInTheDocument();
    expect(screen.queryByText(/não estão sendo trazidas sozinhas/i)).toBeNull();
  });

  it("⚠ o botão «Trazer notas» diz que AJUSTA quando a rotina já está ligada", async () => {
    // "Trazer notas" ali prometeria um ato avulso, e o que ele abre é a troca da data permanente.
    await montarCom({
      ok: true, ligada: true, indisponivel: false, desde: "2026-07-01",
      ultimaTentativaEm: null, ultimoResultadoEm: null,
    });
    expect(await screen.findByRole("button", { name: /Trazer notas · ajustar/i })).toBeInTheDocument();
  });
});
