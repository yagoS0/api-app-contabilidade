// A RESCISÃO DO PARCELAMENTO — a competência do LANÇAMENTO, e a trava que faltava inteira.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// DOIS DEFEITOS, UM SÓ SINTOMA
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// `rescindirParcelamento` gravava os lançamentos do estorno da provisão com
// `competencia: parc.competenciaInicial` — a competência da **1ª PARCELA do contrato**, não a do
// ato. Rescindindo HOJE um acordo migrado cuja 1ª parcela é 2024-06, os lançamentos nasciam com
// `data` de hoje e `competencia: "2024-06"`. Duas consequências, e nenhuma dá erro na tela:
//
//   1. **somem do mês corrente** — o contador rescinde, vai à aba Lançamentos e não acha nada;
//   2. **caem num mês já FECHADO e reportado** — que é o estrago que a trava do DELETE e a do PUT
//      existem para impedir, aqui acontecendo por escrita nova em vez de por edição.
//
// E o segundo defeito é o que torna o primeiro permanente: **não havia UMA chamada a
// `isMonthClosed` em todo o `ParcelamentoService.js`**. Nem sobre a competência velha (que estava
// fechada), nem sobre a do ato.
//
// ⚠ Pior ainda quando o contrato veio pela sentinela: `competenciaInicial = "1970-01"`
// (`ingestParcelamentoFromGuide` grava `compLabel || "1970-01"` — sem `anoMesParcela` o cronograma
// nasce sem datas). O lançamento contábil ia para janeiro de 1970.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// A CORREÇÃO — derivar da DATA DO LANÇAMENTO, com os helpers que já existem
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// É o que `gerarPagamentoParcelaManual` já fazia: competência = a da data do ato, e `isMonthClosed`
// ANTES da transação. Nada de segunda derivação — `competenciaDe` vem de `contraLancamento.js`, a
// mesma que o estorno e os atos administrativos do parcelamento usam.
//
// ⚠ A FORMA DO LANÇAMENTO NÃO MUDA: contas, tipo D/C, valores, `tipoLinha`, `subtipo`, histórico e
// o `loteImportacao` (que é como `desfazerRescisaoParcelamento` acha o lote) seguem idênticos. O
// que muda é a competência sair da data do ato em vez da data do contrato.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const criados = [];
  const tx = {
    accountingEntry: {
      create: jest.fn(async ({ data }) => {
        const entry = { id: `e${criados.length + 1}`, ...data };
        criados.push(entry);
        return entry;
      }),
    },
    parcelamento: { update: jest.fn(async () => ({ id: "parc1", status: "RESCINDIDO" })) },
  };
  return {
    __criados: criados,
    __tx: tx,
    prisma: {
      parcelamento: { findFirst: jest.fn() },
      accountingEntry: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

jest.mock("../fechamentoContabil.js", () => ({ isMonthClosed: jest.fn(async () => false) }));

import { prisma, __tx, __criados } from "../../../infrastructure/db/prisma.js";
import { isMonthClosed } from "../fechamentoContabil.js";
import { rescindirParcelamento } from "../ParcelamentoService.js";
// A derivação NÃO é reescrita aqui — é a mesma função que a correção usa.
import { competenciaDe } from "../contraLancamento.js";

// O contrato do relato: migrado de outra contabilidade, 1ª parcela em 2024-06.
const COMPETENCIA_DA_1A_PARCELA = "2024-06";
const HOJE = new Date("2026-08-16T12:00:00.000Z");
const COMPETENCIA_DE_HOJE = "2026-08";

const PARCELAMENTO = {
  id: "parc1",
  portalClientId: "p1",
  tipo: "PARCSN",
  kind: "SIMPLES",
  numeroParcelamento: "9988",
  numParcelas: 60,
  status: "ATIVO",
  competenciaInicial: COMPETENCIA_DA_1A_PARCELA,
  principalPerParcela: 100,
  jurosTotal: null,
  templateRescision: null, // caminho V2 (o único que produção tem)
  parcelas: [],
  aberturaEntry: null,
  portalClient: { razao: "EMPRESA X", cnpj: "00000000000191" },
  observacoes: null,
};

// A provisão da adesão — é dela que sai o estorno reverso da rescisão.
const PROVISAO = [
  {
    id: "prov1",
    tipo: "PROVISAO",
    lines: [
      { conta: "231", tipo: "C", valor: 6000, tipoLinha: "PARC", codigoTributo: null },
      { conta: "232", tipo: "D", valor: 5000, tipoLinha: "PRINCIPAL", codigoTributo: null },
      { conta: "501", tipo: "D", valor: 1000, tipoLinha: "JUROS", codigoTributo: null },
    ],
  },
];

function fecharApenas(...competencias) {
  const fechadas = new Set(competencias);
  isMonthClosed.mockImplementation(async (_pc, comp) => fechadas.has(comp));
}

beforeEach(() => {
  jest.clearAllMocks();
  __criados.length = 0;
  fecharApenas();
  prisma.parcelamento.findFirst.mockResolvedValue({ ...PARCELAMENTO });
  prisma.accountingEntry.findMany.mockResolvedValue(PROVISAO);
});

const rescindir = (over = {}) => rescindirParcelamento({
  portalClientId: "p1", parcelamentoId: "parc1", dataRescisao: HOJE, userId: "u1", ...over,
});

describe("a competência do lançamento sai da DATA DO ATO, não da 1ª parcela do contrato", () => {
  it("rescindindo hoje um contrato de 2024-06, os lançamentos nascem em 2026-08", async () => {
    await rescindir();
    expect(__criados.length).toBeGreaterThan(0);
    for (const e of __criados) expect(e.competencia).toBe(COMPETENCIA_DE_HOJE);
  });

  it("nenhum lançamento fica na competência da 1ª parcela", async () => {
    await rescindir();
    expect(__criados.map((e) => e.competencia)).not.toContain(COMPETENCIA_DA_1A_PARCELA);
  });

  it("a competência é a MESMA que `competenciaDe` calcula da data gravada (uma derivação só)", async () => {
    await rescindir();
    for (const e of __criados) expect(e.competencia).toBe(competenciaDe(e.data));
  });

  it("⚠ a SENTINELA `1970-01` deixa de virar competência de lançamento contábil", async () => {
    prisma.parcelamento.findFirst.mockResolvedValue({ ...PARCELAMENTO, competenciaInicial: "1970-01" });
    await rescindir();
    expect(__criados.map((e) => e.competencia)).not.toContain("1970-01");
    for (const e of __criados) expect(e.competencia).toBe(COMPETENCIA_DE_HOJE);
  });

  it("sem `dataRescisao` o ato é HOJE, e a competência acompanha", async () => {
    await rescindir({ dataRescisao: undefined });
    const agora = competenciaDe(new Date());
    for (const e of __criados) expect(e.competencia).toBe(agora);
  });
});

describe("⚠ A TRAVA DE MÊS FECHADO — não havia UMA chamada a `isMonthClosed` no arquivo inteiro", () => {
  it("recusa com MES_FECHADO quando a competência do ato está fechada", async () => {
    fecharApenas(COMPETENCIA_DE_HOJE);
    await expect(rescindir()).rejects.toMatchObject({ code: "MES_FECHADO", competencia: COMPETENCIA_DE_HOJE });
  });

  it("a recusa vem ANTES da transação — nem lançamento nem status são escritos", async () => {
    fecharApenas(COMPETENCIA_DE_HOJE);
    await expect(rescindir()).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(__tx.accountingEntry.create).not.toHaveBeenCalled();
    expect(__tx.parcelamento.update).not.toHaveBeenCalled();
    expect(__criados).toHaveLength(0);
  });

  it("a competência PERGUNTADA é a do ato, não a da 1ª parcela", async () => {
    await rescindir();
    const perguntadas = isMonthClosed.mock.calls.map(([, comp]) => comp);
    expect(perguntadas).toContain(COMPETENCIA_DE_HOJE);
    expect(perguntadas).not.toContain(COMPETENCIA_DA_1A_PARCELA);
  });

  it("mês do ato ABERTO segue rescindindo, mesmo com a competência velha fechada", async () => {
    fecharApenas(COMPETENCIA_DA_1A_PARCELA);
    const out = await rescindir();
    expect(out.ok).toBe(true);
    expect(__tx.parcelamento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RESCINDIDO" }) }),
    );
  });
});

describe("⚠ A FORMA DO LANÇAMENTO NÃO MUDOU — só a competência", () => {
  it("o estorno reverso segue invertendo D↔C de todas as pernas da provisão, com contas e valores iguais", async () => {
    await rescindir();
    const porConta = new Map(__criados.map((e) => [e.lines.createMany.data[0].conta, e.lines.createMany.data[0]]));
    expect(porConta.get("231")).toMatchObject({ tipo: "D", valor: 6000, tipoLinha: "PARC" });
    expect(porConta.get("232")).toMatchObject({ tipo: "C", valor: 5000, tipoLinha: "PRINCIPAL" });
    expect(porConta.get("501")).toMatchObject({ tipo: "C", valor: 1000, tipoLinha: "JUROS" });
  });

  it("subtipo, origem e o `loteImportacao` (a chave de `desfazerRescisao`) seguem os mesmos", async () => {
    await rescindir();
    for (const e of __criados) {
      expect(e.subtipo).toBe("PARC_PARCSN");
      expect(e.origem).toBe("MANUAL");
      expect(e.loteImportacao).toBe("PARC-parc1-RESCISAO");
      expect(e.parcelamentoId).toBe("parc1");
      expect(e.statusPagamento).toBe("NA");
    }
  });

  it("a `data` do lançamento continua sendo a do ato (é dela que a competência passa a sair)", async () => {
    await rescindir();
    for (const e of __criados) expect(new Date(e.data).toISOString()).toBe(HOJE.toISOString());
  });

  it("contrato SEM provisão continua só marcando RESCINDIDO, sem lançamento nenhum", async () => {
    prisma.accountingEntry.findMany.mockResolvedValue([]);
    const out = await rescindir();
    expect(out.ok).toBe(true);
    expect(__criados).toHaveLength(0);
    expect(__tx.parcelamento.update).toHaveBeenCalled();
  });
});

describe("data inválida não vira competência inventada", () => {
  it("`dataRescisao` ilegível recusa com `data_invalida` em vez de gravar `NaN-NaN`", async () => {
    await expect(rescindir({ dataRescisao: "não é data" })).rejects.toThrow("data_invalida");
    expect(__criados).toHaveLength(0);
  });
});
