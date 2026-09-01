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

import { render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetFila = jest.fn();
const mockGetPlano = jest.fn();
const mockGetCasamentos = jest.fn();
const mockGetLancados = jest.fn();
const mockGetRegras = jest.fn();
const mockGetRecorrencias = jest.fn();
const mockGetSaidas = jest.fn();
const mockGetMexidas = jest.fn();

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
    [BLOCO.LANCADOS_POR_REGRA, /Lançados por regra/],
    [BLOCO.FILA, "GOOGLE CLOUD BRASIL"],
    [BLOCO.RECORRENCIAS, "Recorrências"],
    [BLOCO.SAIDAS_DO_CLIENTE, "Saídas que o cliente acrescentou"],
    [BLOCO.REGRAS, "Regras do fornecedor"],
  ];

  it.each(ONDE_APARECE)("%s aparece dentro da seção dele", async (bloco, texto) => {
    await montar();
    expect(within(secaoDe(natureza(bloco))).getAllByText(texto).length).toBeGreaterThan(0);
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
