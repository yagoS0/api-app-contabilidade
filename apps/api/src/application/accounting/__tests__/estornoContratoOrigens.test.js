// O CONTRATO DO ESTORNO — não um caso, uma INVARIANTE, exigida de TODA origem de baixa.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// POR QUE ESTE ARQUIVO É DE CONTRATO E NÃO DE CASO
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// O defeito que ele fecha não foi um erro de lógica: foi uma via de baixa NOVA (a F2.2, sem guia,
// ancorada na parcela) que o estorno — escrito quando só existia a guia — simplesmente não
// alcançava. Nada quebrou; a baixa manual estornada deixava a prestação marcada como quitada para
// sempre, fora da fila, sem caminho de volta por nenhuma tela.
//
// Um teste de CASO ("estornar baixa manual limpa origemBaixa") pegaria este defeito e nenhum dos
// próximos. O que este arquivo afirma é a invariante:
//
//     PARA TODA ORIGEM DE BAIXA, ESTORNAR RESTAURA O ESTADO ANTERIOR POR COMPLETO
//     — lançamentos estornados, âncora devolvida ao que era, auditoria gravada.
//
// ⚠ E A LISTA DE ORIGENS VEM DE `ancoraBaixa.js`, NÃO DAQUI. Escrita à mão neste arquivo, alguém
// acrescenta a origem nova no serviço, esquece do teste, e o contrato não morde — que é como as
// DUAS memórias de conta do parcelamento e as QUATRO cópias do filtro de envio nasceram. Vinda da
// fonte única, a próxima via (a do SERPRO, `DETPAGTOPARC165`, que gravará `DEBITO_AUTOMATICO`)
// entra automaticamente na parametrização: ou a âncora dela tem reversor e verificação, ou ISTO
// AQUI FICA VERMELHO até ter — em vez de falhar em produção dezoito meses depois.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const tx = {
    accountingEntry: {
      create: jest.fn(async ({ data }) => ({ id: `espelho-${data.estornoDeEntryId}`, historico: data.historico, competencia: data.competencia })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    guide: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async (args) => ({ id: "g1", ...args.data })),
    },
    parcela: {
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    parcelamento: { findFirst: jest.fn(async () => ({ id: "parc1", status: "ATIVO", numParcelas: 60 })) },
    estornoBaixa: { create: jest.fn(async () => ({ id: "est1" })) },
  };
  return {
    __tx: tx,
    prisma: {
      accountingEntry: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      guide: { findFirst: jest.fn(async () => null) },
      parcela: { findMany: jest.fn(async () => []) },
      parcelamento: { findFirst: jest.fn(async () => ({ id: "parc1", status: "ATIVO", numParcelas: 60 })) },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

jest.mock("../fechamentoContabil.js", () => ({ isMonthClosed: jest.fn(async () => false) }));

import { prisma, __tx } from "../../../infrastructure/db/prisma.js";
import { isMonthClosed } from "../fechamentoContabil.js";
import {
  ANCORAS, ORIGENS_BAIXA_PARCELA, ORIGENS_ESTORNAVEIS, ancoraDoLancamento,
} from "../ancoraBaixa.js";
import { executarEstorno, previewEstorno, REVERSORES } from "../EstornoBaixaService.js";

const MOTIVO = "baixa lançada na prestação errada";
const COMP_BAIXA = "2020-07";
const COMP_HOJE = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
})();

const lancamento = (over) => ({
  portalClientId: "p1", tipo: "BAIXA", status: "RASCUNHO", competencia: COMP_BAIXA,
  data: new Date("2020-07-15T00:00:00Z"), subtipo: "PARC_PARCSN", origem: "MANUAL",
  eventType: null, openEntryId: "abertura1", parcelamentoId: "parc1",
  sourceGuideId: null, numeroParcela: null, loteImportacao: null,
  tipoLinha: "PARC", codigoTributo: null, historico: "PAGAMENTO", lines: [],
  ...over,
});

const linha = (conta, valor) => [{ conta, tipo: "D", valor, ordem: 0, tipoLinha: "PARC", codigoTributo: null }];

// ════════════════════════════════════════════════════════════════════════════════════════════
// AS ÂNCORAS, COM O MUNDO DE CADA UMA E O QUE "RESTAURADO POR COMPLETO" SIGNIFICA NELA
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ Esta tabela é indexada pelas âncoras de `ancoraBaixa.js`, e um teste estrutural abaixo exige
// que ela as cubra TODAS. Âncora nova sem entrada aqui = vermelho.
const ANCORAS_FIXTURE = {
  [ANCORAS.GUIA]: {
    // Baixa por guia: os DOIS vínculos na mesma linha (a guia e o contrato).
    lote: [
      lancamento({ id: "b1", sourceGuideId: "g1", numeroParcela: 3, historico: "PAG PARC 3 — principal", lines: linha("553", 392.58) }),
      lancamento({ id: "b2", sourceGuideId: "g1", numeroParcela: 3, tipoLinha: "JUROS", historico: "PAG PARC 3 — juros", lines: linha("501", 7.42) }),
    ],
    preparar() {
      prisma.guide.findFirst.mockResolvedValue({
        id: "g1", parcelamentoId: "parc1", numeroParcela: 3, parcelaEstado: "PAGA_A_CONFERIR",
        paymentStatus: "PAID", paymentStatusSource: "MANUAL", lancamentoId: "b1", baixada: true,
        vencimento: new Date("2020-07-20T00:00:00Z"), valor: 400, tipo: "SIMPLES", competencia: COMP_BAIXA,
      });
      __tx.guide.findFirst.mockResolvedValue({
        id: "g1", paymentStatusSource: "MANUAL", lancamentoId: "b1",
        parcelamentoId: "parc1", parcelaEstado: "PAGA_A_CONFERIR", vencimento: new Date("2020-07-20T00:00:00Z"),
      });
    },
    // O estado anterior da guia: aberta, sem baixa, de volta à fila.
    esperaAncoraRestaurada() {
      expect(__tx.guide.update).toHaveBeenCalledTimes(1);
      expect(__tx.guide.update.mock.calls[0][0].data).toMatchObject({
        baixada: false, dataBaixa: null, lancamentoId: null, parcelaEstado: "ESTORNADA",
      });
      // A prestação não é tocada por este caminho — quem responde "foi quitada?" aqui é a guia.
      expect(__tx.parcela.updateMany).not.toHaveBeenCalled();
    },
  },

  [ANCORAS.PARCELA]: {
    // F2.2 — baixa SEM GUIA: `sourceGuideId` NULL, e o que identifica a prestação é
    // `(parcelamentoId, numeroParcela)`. Duas linhas de propósito: o lote também tem de sair
    // inteiro por esta âncora (antes desta fase ele saía UMA linha por vez).
    lote: [
      lancamento({ id: "m1", numeroParcela: 7, loteImportacao: "PARCV2-abcdef12-PAGM-7", historico: "PAGAMENTO PARCSN PARC 7/60 (declarado) — parcelamento", lines: linha("553", 500) }),
      lancamento({ id: "m2", numeroParcela: 7, loteImportacao: "PARCV2-abcdef12-PAGM-7", tipoLinha: "JUROS", historico: "PAGAMENTO PARCSN PARC 7/60 (declarado) — juros", lines: linha("501", 18) }),
    ],
    preparar(origem) {
      prisma.guide.findFirst.mockResolvedValue(null);
      // A prestação baixada por ESTA origem — é o que `carregarParcelaDaBaixa` encontra.
      prisma.parcela.findMany.mockImplementation(async (args) => (
        args?.where?.origemBaixa?.not === null && args?.where?.numeroParcela !== undefined
          ? [{
            id: "pc7", numeroParcela: 7, competencia: "2026-07", vencimento: new Date("2026-07-01T00:00:00Z"),
            valorPrevisto: 500, origemBaixa: origem, baixadaEm: new Date("2026-07-18T00:00:00Z"),
          }]
          : []
      ));
    },
    // ⚠ O ESTADO ANTERIOR DE UMA PRESTAÇÃO SEM GUIA É A AUSÊNCIA DE `origemBaixa`. Não há coluna de
    // estado (a F2.1 evitou a segunda cópia de propósito): `parcelaRowQuitada` só pergunta isso, e
    // é limpando os dois campos que a prestação volta à fila.
    esperaAncoraRestaurada() {
      expect(__tx.parcela.updateMany).toHaveBeenCalledTimes(1);
      const chamada = __tx.parcela.updateMany.mock.calls[0][0];
      expect(chamada.data).toEqual({ origemBaixa: null, baixadaEm: null });
      expect(chamada.where).toMatchObject({ id: "pc7", portalClientId: "p1" });
      // Não há guia a reabrir — e tocar numa seria inventar documento.
      expect(__tx.guide.update).not.toHaveBeenCalled();
    },
  },

  [ANCORAS.LANCAMENTO]: {
    // A baixa genérica (`POST /entries/:id/baixa`): sem guia e sem contrato. Ela entra na tabela
    // para que "não há terceiro efeito" seja uma decisão declarada, e não um `if` que não casou.
    lote: [lancamento({ id: "x1", parcelamentoId: null, tipoLinha: "TOTAL", historico: "BAIXA INSS", lines: linha("233", 120) })],
    preparar() {
      prisma.guide.findFirst.mockResolvedValue(null);
    },
    esperaAncoraRestaurada() {
      expect(__tx.guide.update).not.toHaveBeenCalled();
      expect(__tx.parcela.updateMany).not.toHaveBeenCalled();
    },
  },
};

/** Arma o mundo do estorno para uma âncora — o lote, a releitura dentro da transação, a âncora. */
function armar(ancora, origem = null) {
  const fixture = ANCORAS_FIXTURE[ancora];
  const lote = fixture.lote;
  prisma.accountingEntry.findFirst.mockResolvedValue({ ...lote[0] });
  prisma.accountingEntry.findMany.mockResolvedValue(lote.map((e) => ({ ...e })));
  __tx.accountingEntry.findMany.mockImplementation(async (args) => (
    args?.where?.id?.notIn ? [] : lote.map((e) => ({ ...e }))
  ));
  fixture.preparar(origem);
  return { fixture, lote };
}

beforeEach(() => {
  jest.clearAllMocks();
  isMonthClosed.mockResolvedValue(false);
  prisma.parcela.findMany.mockResolvedValue([]);
  prisma.parcelamento.findFirst.mockResolvedValue({ id: "parc1", status: "ATIVO", numParcelas: 60 });
  __tx.parcela.findMany.mockResolvedValue([]);
  __tx.parcela.updateMany.mockResolvedValue({ count: 1 });
  __tx.parcelamento.findFirst.mockResolvedValue({ id: "parc1", status: "ATIVO", numParcelas: 60 });
  __tx.accountingEntry.findFirst.mockResolvedValue(null);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1. O CONTRATO, PARAMETRIZADO PELAS ORIGENS QUE EXISTEM
// ════════════════════════════════════════════════════════════════════════════════════════════
describe.each(ORIGENS_ESTORNAVEIS)("origem de baixa %s", (origem) => {
  const { ancora } = ORIGENS_BAIXA_PARCELA[origem];

  it("tem uma âncora conhecida, com reversor e com verificação neste contrato", () => {
    // ⚠ É AQUI QUE A VIA NOVA TROPEÇA. Quem acrescentar uma origem com âncora nova (um estado que o
    // estorno não sabe desfazer) vê VERMELHO até escrever o reversor — em vez de descobrir em
    // produção que a baixa dele não tem volta.
    expect(Object.values(ANCORAS)).toContain(ancora);
    expect(typeof REVERSORES[ancora]).toBe("function");
    expect(ANCORAS_FIXTURE[ancora]).toBeDefined();
  });

  it("⚠ estornar RESTAURA O ESTADO ANTERIOR POR COMPLETO (mês aberto: os lançamentos saem)", async () => {
    const { fixture, lote } = armar(ancora, origem);

    const out = await executarEstorno({ portalClientId: "p1", entryId: lote[0].id, motivo: MOTIVO, userId: "u1" });

    expect(out.ok).toBe(true);
    expect(out.ancora).toBe(ancora);
    // 1. OS LANÇAMENTOS — o LOTE INTEIRO, nunca um de dois. Estornar só o principal deixaria os
    //    juros no razão com a prestação já devolvida à fila (o "estado misto" desta fase).
    expect(__tx.accountingEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: lote.map((e) => e.id) }, portalClientId: "p1" },
    });
    // 2. A ÂNCORA — cada uma tem o seu "estado anterior", e ele é verificado por inteiro.
    fixture.esperaAncoraRestaurada();
    // 3. A AUDITORIA — uma linha por lançamento desfeito, com motivo.
    expect(__tx.estornoBaixa.create).toHaveBeenCalledTimes(lote.length);
    expect(__tx.estornoBaixa.create.mock.calls[0][0].data).toMatchObject({ motivo: MOTIVO, estornadoPorUserId: "u1" });
  });

  it("⚠ em MÊS FECHADO a restauração é a mesma, mas por CONTRA-LANÇAMENTO (nada é apagado)", async () => {
    isMonthClosed.mockImplementation(async (_p, comp) => comp === COMP_BAIXA);
    const { fixture, lote } = armar(ancora, origem);

    const out = await executarEstorno({ portalClientId: "p1", entryId: lote[0].id, motivo: MOTIVO });

    expect(out.modo).toBe("CONTRA_LANCAMENTO");
    expect(__tx.accountingEntry.deleteMany).not.toHaveBeenCalled();
    expect(__tx.accountingEntry.create).toHaveBeenCalledTimes(lote.length);
    const espelho = __tx.accountingEntry.create.mock.calls[0][0].data;
    expect(espelho.competencia).toBe(COMP_HOJE);
    // O espelho NÃO é `tipo:"BAIXA"` — como baixa ele colidiria com `uq_baixa_guia_linha` e seria
    // contado como MAIS amortização por `computeSaldoProvisao`.
    expect(espelho.tipo).toBe("ESTORNO");
    // ⚠ E a âncora volta igual: a trava de mês fechado muda o QUE se faz com o lançamento, nunca o
    // que se faz com a prestação. Sem isto, a baixa manual de competência fechada ficaria presa.
    fixture.esperaAncoraRestaurada();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2. AS ORIGENS QUE **NÃO** SE ESTORNAM POR AQUI TÊM DE DIZER POR QUÊ
// ════════════════════════════════════════════════════════════════════════════════════════════
describe("origens não estornáveis", () => {
  const naoEstornaveis = Object.entries(ORIGENS_BAIXA_PARCELA).filter(([, v]) => !v.geraLancamento);

  it.each(naoEstornaveis)("%s declara o motivo de estar fora do estorno", (_origem, meta) => {
    // ⚠ "Ausência nunca é resposta": uma origem fora do contrato não pode simplesmente não aparecer
    // na lista — a diferença entre "não se estorna porque não gera lançamento" e "esqueceram de
    // implementar" é exatamente o que este campo obriga a escrever.
    expect(typeof meta.motivoNaoEstornavel).toBe("string");
    expect(meta.motivoNaoEstornavel.length).toBeGreaterThan(20);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3. O DESPACHO É COMPLETO — nenhuma âncora fica sem reversor
// ════════════════════════════════════════════════════════════════════════════════════════════
describe("despacho por âncora", () => {
  it("toda âncora declarada tem reversor no serviço (um serviço só, sem irmão)", () => {
    expect(Object.keys(REVERSORES).sort()).toEqual(Object.values(ANCORAS).sort());
  });

  it("toda âncora declarada tem fixture neste contrato", () => {
    expect(Object.keys(ANCORAS_FIXTURE).sort()).toEqual(Object.values(ANCORAS).sort());
  });

  it("a âncora é lida do LANÇAMENTO, não recebida por parâmetro", () => {
    expect(ancoraDoLancamento({ sourceGuideId: "g1", parcelamentoId: "parc1" })).toBe(ANCORAS.GUIA);
    expect(ancoraDoLancamento({ sourceGuideId: null, parcelamentoId: "parc1" })).toBe(ANCORAS.PARCELA);
    expect(ancoraDoLancamento({})).toBe(ANCORAS.LANCAMENTO);
  });

  it("a baixa GENÉRICA (sem guia e sem contrato) continua se estornando como sempre", async () => {
    const { fixture, lote } = armar(ANCORAS.LANCAMENTO);
    const out = await executarEstorno({ portalClientId: "p1", entryId: "x1", motivo: MOTIVO });
    expect(out.ok).toBe(true);
    expect(out.ancora).toBe(ANCORAS.LANCAMENTO);
    expect(__tx.accountingEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: lote.map((e) => e.id) }, portalClientId: "p1" },
    });
    fixture.esperaAncoraRestaurada();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 4. ATOMICIDADE — falhar no meio não pode deixar estado MISTO
// ════════════════════════════════════════════════════════════════════════════════════════════
describe("a reversão da âncora é atômica com o estorno dos lançamentos", () => {
  it("⚠ se a prestação mudou, a operação INTEIRA é recusada de dentro da transação", async () => {
    const { lote } = armar(ANCORAS.PARCELA, "MANUAL");
    // Outra sessão estornou primeiro (ou a captura vinculou uma guia): o `where` condicional não
    // casa mais.
    __tx.parcela.updateMany.mockResolvedValue({ count: 0 });

    await expect(executarEstorno({ portalClientId: "p1", entryId: lote[0].id, motivo: MOTIVO }))
      .rejects.toMatchObject({ code: "PARCELA_MUDOU" });

    // ⚠ A EXCEÇÃO SOBE DE DENTRO DO `$transaction` — é o que faz o Postgres desfazer o que já
    // tinha sido escrito nele. Sem isso, `origemBaixa` limpo com o estorno falhando (ou o inverso)
    // deixaria a prestação baixada no razão e livre na fila: pior que os dois estados.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(__tx.estornoBaixa.create).not.toHaveBeenCalled();
  });

  it("⚠ DUAS prestações presas com a mesma identificação: RECUSA ANTES de escrever", async () => {
    armar(ANCORAS.PARCELA, "MANUAL");
    // Adivinhar qual destravar deixaria a outra baixada no cadastro e livre no razão — para sempre.
    prisma.parcela.findMany.mockImplementation(async (args) => (
      args?.where?.origemBaixa?.not === null
        ? [{ id: "pc7", origemBaixa: "MANUAL" }, { id: "pc7b", origemBaixa: "MANUAL" }]
        : []
    ));

    await expect(executarEstorno({ portalClientId: "p1", entryId: "m1", motivo: MOTIVO }))
      .rejects.toMatchObject({ code: "PARCELA_NAO_IDENTIFICADA" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("⚠ NENHUMA prestação presa NÃO é recusa — obstruir aí seria travar correção legítima", async () => {
    // Baixa de parcelamento que nunca marcou prestação (o V1 aplicado por template não escreve em
    // `parcelas`), ou estorno repetido: não há nada a destravar, e os lançamentos têm de sair.
    const { lote } = armar(ANCORAS.PARCELA, "MANUAL");
    prisma.parcela.findMany.mockResolvedValue([]);

    const out = await executarEstorno({ portalClientId: "p1", entryId: lote[0].id, motivo: MOTIVO });
    expect(out.ok).toBe(true);
    expect(out.parcela).toBeNull();
    expect(__tx.accountingEntry.deleteMany).toHaveBeenCalled();
    expect(__tx.parcela.updateMany).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// 5. O PREVIEW MOSTRA A PRESTAÇÃO — ato de consequência confirma repetindo os dados
// ════════════════════════════════════════════════════════════════════════════════════════════
describe("preview da baixa sem guia", () => {
  it("mostra o lote inteiro, a prestação e que ela volta para a fila", async () => {
    const { lote } = armar(ANCORAS.PARCELA, "MANUAL");
    const preview = await previewEstorno({ portalClientId: "p1", entryId: lote[0].id });

    expect(preview.ancora).toBe(ANCORAS.PARCELA);
    expect(preview.lancamentos).toHaveLength(2);
    expect(preview.totalEstornado).toBe(518);
    expect(preview.guia).toBeNull();
    expect(preview.parcela).toMatchObject({
      id: "pc7", numeroParcela: 7, origemBaixa: "MANUAL",
      origemBaixaAposEstorno: null, voltaParaFila: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("⚠ a prestação é procurada pelo que pode FICAR PRESO (`origemBaixa` preenchido)", async () => {
    // ⚠ `guiaId` fora do filtro de propósito: a captura do SERPRO pode vincular uma guia à prestação
    // DEPOIS da baixa por declaração, e é justamente essa que precisaria ser limpa.
    const { lote } = armar(ANCORAS.PARCELA, "MANUAL");
    await previewEstorno({ portalClientId: "p1", entryId: lote[0].id });
    const where = prisma.parcela.findMany.mock.calls.map((c) => c[0]?.where).find((w) => w?.origemBaixa);
    expect(where).toMatchObject({ parcelamentoId: "parc1", numeroParcela: 7, origemBaixa: { not: null } });
    expect(where.guiaId).toBeUndefined();
  });

  it("⚠ o lote sem guia é reunido por (parcelamentoId, numeroParcela) — não por guia nenhuma", async () => {
    const { lote } = armar(ANCORAS.PARCELA, "MANUAL");
    await previewEstorno({ portalClientId: "p1", entryId: lote[0].id });
    const where = prisma.accountingEntry.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      parcelamentoId: "parc1", numeroParcela: 7, sourceGuideId: null, tipo: "BAIXA",
    });
  });
});
