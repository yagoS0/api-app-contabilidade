// OS ATOS DO CONTRATO — excluir o parcelamento, desfazer a rescisão.
//
// ⚠ O QUE ESTE ARQUIVO PROTEGE não é "a exclusão apaga". É a forma dela, que é onde este projeto já
// se machucou:
//
//   · **autonomia**: contrato com prestação QUITADA continua excluível. O peso vira AVISO, nunca
//     bloqueio — quem sabe se o dinheiro saiu é o contador, não o servidor;
//   · **motivo antes de tudo**: sem motivo a operação não começa, e nada é lido;
//   · **mês fechado não apaga**: o lançamento fica, nasce o espelho na competência de hoje, e o
//     CABEÇALHO SOBREVIVE — sem ele, `computeFechamentoBlockers` perde a chave do grupo e os
//     lançamentos de uma perna só travam o fechamento;
//   · **a guia é DESVINCULADA, nunca apagada** — ela é um documento que chegou;
//   · **a guia baixada REABRE** — `Guide.lancamentoId` não tem FK, e deixá-lo apontando para uma
//     linha apagada é o beco sem saída que este módulo já produziu duas vezes.

jest.mock("../../../../infrastructure/db/prisma.js", () => {
  // ⚠ O `tx` mora DENTRO da factory: o Jest proíbe a factory de referenciar variável de fora
  // (guarda contra mock não inicializado). Ele sai daqui pelo `__tx`, como no teste do estorno.
  const tx = {
    accountingEntry: {
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async ({ data }) => ({ id: `espelho-${data.estornoDeEntryId}`, historico: data.historico, competencia: data.competencia })),
    },
    guide: {
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
      delete: jest.fn(async () => ({})),
    },
    parcela: { deleteMany: jest.fn(async () => ({ count: 0 })), findMany: jest.fn(async () => []) },
    parcelamento: {
      delete: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
    },
    atoParcelamento: { create: jest.fn(async () => ({ id: "ato1" })) },
  };
  return {
    __tx: tx,
    prisma: {
      parcelamento: { findFirst: jest.fn(async () => null) },
      accountingEntry: { findMany: jest.fn(async () => []) },
      parcela: { findMany: jest.fn(async () => []) },
      guide: { findMany: jest.fn(async () => []) },
      companyMonthlyCircular: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

import { prisma, __tx as tx } from "../../../../infrastructure/db/prisma.js";
import {
  previewExclusaoParcelamento, excluirParcelamento,
  previewDesfazerRescisao, desfazerRescisaoParcelamento,
  loteDaRescisao, MODO, STATUS_EXCLUIDO, AtoRecusado,
} from "../AtosParcelamentoService.js";
import { whereParcelaSemGuiaPendente, whereParcelaForaDaFilaPorRescisao } from "../recalculoParcelamento.js";

const CLIENTE = "cli1";
const PARC_ID = "parc-1";
const AGORA = new Date("2026-08-10T12:00:00.000Z");
const COMP_HOJE = "2026-08";
const MOTIVO = "parcelamento lançado errado — o certo é o nº 0211";

const CONTRATO = {
  id: PARC_ID, label: "PARCELAMENTO OUTRO Nº 3", tipo: "OUTRO", kind: "SIMPLES",
  numeroParcelamento: "3", status: "ATIVO", competenciaInicial: "2026-01",
  numParcelas: 60, totalValue: 38037.74, principalPerParcela: 633.96,
  saldoConsolidado: null, aberturaEntryId: "e-abertura", formaPagamento: null, observacoes: null,
};

const linha = (conta, valor, tipo = "D") => [{ conta, tipo, valor, ordem: 0, tipoLinha: null, codigoTributo: null }];
const lancamento = (over = {}) => ({
  id: "e1", portalClientId: CLIENTE, tipo: "PROVISAO", subtipo: "PARC_OUTRO", status: "RASCUNHO",
  competencia: "2026-01", data: new Date("2026-01-20T12:00:00Z"), historico: "PROVISÃO OUTRO — principal",
  openEntryId: null, sourceGuideId: null, parcelamentoId: PARC_ID, numeroParcela: null,
  loteImportacao: "PARCV2-parc-1-PROV", tipoLinha: "PRINCIPAL", codigoTributo: null,
  lines: linha("553", 1000),
  ...over,
});

function montarBase({ lancamentos = [], parcelas = [], guias = [], fechadas = [] } = {}) {
  prisma.parcelamento.findFirst.mockResolvedValue({ ...CONTRATO });
  prisma.accountingEntry.findMany.mockResolvedValue(lancamentos);
  prisma.parcela.findMany.mockResolvedValue(parcelas);
  prisma.guide.findMany.mockResolvedValue(guias);
  prisma.companyMonthlyCircular.findUnique.mockImplementation(async ({ where }) => (
    fechadas.includes(where.portalClientId_competencia.competencia)
      ? { fechadoContabilEm: new Date("2026-02-05T00:00:00Z") }
      : null
  ));
  tx.accountingEntry.findMany.mockResolvedValue(lancamentos);
  tx.guide.findMany.mockResolvedValue(guias.map((g) => ({ id: g.id, baixada: g.baixada, lancamentoId: g.lancamentoId })));
  tx.parcela.deleteMany.mockResolvedValue({ count: parcelas.length });
  tx.parcela.findMany.mockResolvedValue(parcelas);
  tx.parcelamento.findFirst.mockResolvedValue({ ...CONTRATO, status: "ATIVO" });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("preview da exclusão — os números REAIS, e nada escrito", () => {
  it("conta prestações, guias e lançamentos, e soma só os DÉBITOS", async () => {
    montarBase({
      lancamentos: [
        lancamento({ id: "e-abertura", lines: linha("553", 12000, "C") }),
        lancamento({ id: "b1", tipo: "BAIXA", competencia: "2026-03", lines: linha("553", 633.96) }),
        // ⚠ A linha leve de rastreio NÃO entra no total: ela não tem linha D/C nenhuma.
        lancamento({ id: "leve-1", tipo: "PARCELA", lines: [] }),
      ],
      parcelas: [
        { id: "p1", numeroParcela: 1, origemBaixa: "MANUAL", guia: null, vencimento: new Date("2026-01-20") },
        { id: "p2", numeroParcela: 2, origemBaixa: null, guia: null, vencimento: new Date("2026-02-20") },
      ],
      guias: [{ id: "g1", tipo: "SIMPLES", competencia: "2026-03", numeroParcela: 3, valor: 633.96, baixada: true, paymentStatus: "PAID", paymentStatusSource: "SERPRO", lancamentoId: "b1" }],
    });

    const p = await previewExclusaoParcelamento({ portalClientId: CLIENTE, parcelamentoId: PARC_ID, agora: AGORA });

    expect(p.lancamentos.total).toBe(2);
    expect(p.lancamentos.linhasDeRastreio).toBe(1);
    expect(p.totalDesfeito).toBe(12633.96); // 12000 (crédito de perna única) + 633,96
    expect(p.prestacoes).toEqual({ total: 2, quitadas: 1, semEvidencia: 1 });
    expect(p.guias.total).toBe(1);
    expect(p.modo).toBe(MODO.DELECAO);
    expect(p.cabecalhoRemovido).toBe(true);
    // Nada foi escrito.
    expect(tx.accountingEntry.deleteMany).not.toHaveBeenCalled();
    expect(tx.parcelamento.delete).not.toHaveBeenCalled();
  });

  it("⚠ AUTONOMIA: prestação QUITADA vira AVISO com o número, nunca bloqueio", async () => {
    montarBase({
      lancamentos: [lancamento({ id: "b1", tipo: "BAIXA", lines: linha("553", 500) })],
      parcelas: [{ id: "p1", numeroParcela: 1, origemBaixa: "MANUAL", guia: null }],
    });

    const p = await previewExclusaoParcelamento({ portalClientId: CLIENTE, parcelamentoId: PARC_ID, agora: AGORA });

    expect(p.bloqueios).toEqual([]);
    const aviso = p.avisos.find((a) => a.code === "PRESTACOES_COM_BAIXA");
    expect(aviso.quantidade).toBe(1);
    // O peso está na tela, com número — é o que substitui a tutela.
    expect(aviso.message).toMatch(/1 de 1 prestações constam QUITADAS/);
  });

  it("diz o que acontece com a guia: ela MUDA DE COLUNA no dashboard, não some", async () => {
    montarBase({
      guias: [{ id: "g1", tipo: "SIMPLES", competencia: "2026-03", numeroParcela: 3, valor: 100, baixada: false, paymentStatus: "OPEN", paymentStatusSource: null, lancamentoId: null }],
    });

    const p = await previewExclusaoParcelamento({ portalClientId: CLIENTE, parcelamentoId: PARC_ID, agora: AGORA });

    // A conta é feita com `colunaMatrizDaGuia`, a MESMA do dashboard — não com um `if` local.
    expect(p.guias.lista[0]).toMatchObject({ deColuna: "PARC_DAS", paraColuna: "DAS" });
    expect(p.guias.voltamAContarComo).toEqual(["DAS"]);
    expect(p.avisos.some((a) => a.code === "GUIAS_DESVINCULADAS")).toBe(true);
  });

  it("competência FECHADA muda o modo e diz a competência do contra-lançamento", async () => {
    montarBase({
      lancamentos: [lancamento({ id: "e1", competencia: "2026-01" })],
      fechadas: ["2026-01"],
    });

    const p = await previewExclusaoParcelamento({ portalClientId: CLIENTE, parcelamentoId: PARC_ID, agora: AGORA });

    expect(p.modo).toBe(MODO.CONTRA_LANCAMENTO);
    expect(p.competenciaContraLancamento).toBe(COMP_HOJE);
    expect(p.competenciasFechadas).toEqual(["2026-01"]);
    // ⚠ E o cabeçalho NÃO será removido — é ele que segura o grupo do fechamento.
    expect(p.cabecalhoRemovido).toBe(false);
    expect(p.lancamentos.lista[0].mesFechado).toBe(true);
  });

  it("lançamento EXPORTADO bloqueia, com o motivo e o caminho", async () => {
    montarBase({ lancamentos: [lancamento({ id: "e1", status: "EXPORTADO" })] });

    const p = await previewExclusaoParcelamento({ portalClientId: CLIENTE, parcelamentoId: PARC_ID, agora: AGORA });

    expect(p.bloqueios[0].code).toBe("LOTE_JA_EXPORTADO");
    expect(p.bloqueios[0].message).toMatch(/já saiu daqui para a contabilidade/);
  });
});

describe("execução da exclusão", () => {
  it("⚠ MOTIVO É A PRIMEIRA COISA — sem ele nada é sequer LIDO", async () => {
    montarBase({});

    await expect(excluirParcelamento({ portalClientId: CLIENTE, parcelamentoId: PARC_ID, motivo: "  x  " }))
      .rejects.toMatchObject({ code: "MOTIVO_OBRIGATORIO" });
    expect(prisma.parcelamento.findFirst).not.toHaveBeenCalled();
  });

  it("mês ABERTO: apaga os lançamentos, as prestações e o CABEÇALHO — e grava o ato", async () => {
    montarBase({
      lancamentos: [lancamento({ id: "e1" }), lancamento({ id: "leve", tipo: "PARCELA", lines: [] })],
      parcelas: [{ id: "p1", numeroParcela: 1, origemBaixa: null, guia: null }],
    });

    const out = await excluirParcelamento({
      portalClientId: CLIENTE, parcelamentoId: PARC_ID, motivo: MOTIVO, userId: "u1", agora: AGORA,
    });

    expect(out.modo).toBe(MODO.DELECAO);
    expect(out.cabecalhoRemovido).toBe(true);
    // A linha leve sai junto com o lançamento contábil.
    expect(tx.accountingEntry.deleteMany.mock.calls[0][0].where.id.in.sort()).toEqual(["e1", "leve"]);
    expect(tx.accountingEntry.create).not.toHaveBeenCalled(); // nenhum espelho em mês aberto
    expect(tx.parcelamento.delete).toHaveBeenCalledWith({ where: { id: PARC_ID } });
    expect(tx.atoParcelamento.create.mock.calls[0][0].data).toMatchObject({
      ato: "EXCLUSAO", motivo: MOTIVO, executadoPorUserId: "u1", modo: MODO.DELECAO,
      labelOriginal: CONTRATO.label, numeroParcelamentoOriginal: "3", cabecalhoRemovido: true,
    });
  });

  it("mês FECHADO: NÃO apaga — espelha, e o cabeçalho SOBREVIVE como âncora do grupo", async () => {
    montarBase({
      lancamentos: [lancamento({ id: "e1", competencia: "2026-01" })],
      fechadas: ["2026-01"],
    });

    const out = await excluirParcelamento({
      portalClientId: CLIENTE, parcelamentoId: PARC_ID, motivo: MOTIVO, agora: AGORA,
    });

    expect(out.modo).toBe(MODO.CONTRA_LANCAMENTO);
    expect(tx.accountingEntry.deleteMany).not.toHaveBeenCalled();
    const espelho = tx.accountingEntry.create.mock.calls[0][0].data;
    // ⚠ O espelho é `tipo:"ESTORNO"` — como BAIXA ele colidiria com `uq_baixa_guia_linha`.
    expect(espelho.tipo).toBe("ESTORNO");
    expect(espelho.competencia).toBe(COMP_HOJE);
    // ⚠ `parcelamentoId` obrigatório: o lote só balanceia EM GRUPO.
    expect(espelho.parcelamentoId).toBe(PARC_ID);
    expect(espelho.historico).toMatch(/^EXCLUSAO /);
    // ⚠ O CABEÇALHO FICA, invisível, com a chave única liberada para o recadastro do mesmo número.
    expect(tx.parcelamento.delete).not.toHaveBeenCalled();
    expect(tx.parcelamento.update.mock.calls[0][0].data).toMatchObject({
      status: STATUS_EXCLUIDO, numeroParcelamento: null,
    });
    expect(out.cabecalhoRemovido).toBe(false);
  });

  it("a guia é DESVINCULADA e REABERTA — nunca apagada", async () => {
    montarBase({
      lancamentos: [lancamento({ id: "b1", tipo: "BAIXA", sourceGuideId: "g1", lines: linha("553", 500) })],
      guias: [{ id: "g1", tipo: "SIMPLES", competencia: "2026-03", numeroParcela: 3, valor: 500, baixada: true, paymentStatus: "PAID", paymentStatusSource: "SERPRO", lancamentoId: "b1" }],
    });

    await excluirParcelamento({ portalClientId: CLIENTE, parcelamentoId: PARC_ID, motivo: MOTIVO, agora: AGORA });

    expect(tx.guide.delete).not.toHaveBeenCalled();
    const data = tx.guide.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      parcelamentoId: null, numeroParcela: null, parcelaEstado: null,
      // ⚠ `lancamentoId` NÃO TEM FK: sem isto a guia fica "baixada" apontando para nada, some da
      // fila de pendentes e responde `ja_baixada` para sempre.
      baixada: false, lancamentoId: null,
    });
    // ⚠ O pagamento confirmado pela Receita NÃO é desfeito — é fato dela, não deste contrato.
    expect(data.paymentStatus).toBeUndefined();
  });

  it("recusa quando o total conferido na tela não é mais o total de agora", async () => {
    montarBase({ lancamentos: [lancamento({ id: "e1", lines: linha("553", 1000) })] });

    await expect(excluirParcelamento({
      portalClientId: CLIENTE, parcelamentoId: PARC_ID, motivo: MOTIVO, totalConferido: 500, agora: AGORA,
    })).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
    expect(tx.accountingEntry.deleteMany).not.toHaveBeenCalled();
  });
});

describe("desfazer a rescisão", () => {
  it("só existe sobre contrato RESCINDIDO, e diz o status quando não é", async () => {
    montarBase({});
    const p = await previewDesfazerRescisao({ portalClientId: CLIENTE, parcelamentoId: PARC_ID, agora: AGORA });
    expect(p.bloqueios[0].code).toBe("PARCELAMENTO_NAO_RESCINDIDO");
    expect(p.bloqueios[0].message).toMatch(/está ATIVO/);
  });

  it("devolve o contrato a ATIVO, tira os lançamentos da rescisão e grava o ato", async () => {
    montarBase({});
    prisma.parcelamento.findFirst.mockResolvedValue({ ...CONTRATO, status: "RESCINDIDO" });
    const rescisao = lancamento({ id: "r1", loteImportacao: loteDaRescisao(PARC_ID), historico: "ESTORNO/RESCISÃO OUTRO Nº 3 — principal" });
    prisma.accountingEntry.findMany.mockResolvedValue([rescisao]);
    tx.accountingEntry.findMany.mockResolvedValue([rescisao]);
    tx.parcelamento.findFirst.mockResolvedValue({ id: PARC_ID, status: "ATIVO", numParcelas: 60 });

    const out = await desfazerRescisaoParcelamento({
      portalClientId: CLIENTE, parcelamentoId: PARC_ID, motivo: "rescindido por engano", userId: "u1", agora: AGORA,
    });

    expect(out.status).toBe("ATIVO");
    expect(tx.parcelamento.update).toHaveBeenCalledWith({ where: { id: PARC_ID }, data: { status: "ATIVO" } });
    expect(tx.accountingEntry.deleteMany.mock.calls[0][0].where.id.in).toEqual(["r1"]);
    expect(tx.atoParcelamento.create.mock.calls[0][0].data).toMatchObject({
      ato: "RESCISAO_DESFEITA", motivo: "rescindido por engano", statusOriginal: "RESCINDIDO",
    });
    // ⚠ O recálculo roda DEPOIS das escritas e volta na resposta: o contrato pode reviver já
    // rescindível, e quem desfez precisa ver isso agora, não na próxima tela.
    expect(out.recalculo).not.toBeNull();
  });

  it("conta as prestações que VOLTAM para a fila — é o que a rescisão tinha engolido", async () => {
    montarBase({
      parcelas: [
        { id: "p1", numeroParcela: 1, origemBaixa: null, guia: null, vencimento: new Date("2026-07-20T12:00:00Z") },
        { id: "p2", numeroParcela: 2, origemBaixa: null, guia: null, vencimento: new Date("2026-12-20T12:00:00Z") },
      ],
    });
    prisma.parcelamento.findFirst.mockResolvedValue({ ...CONTRATO, status: "RESCINDIDO" });

    const p = await previewDesfazerRescisao({ portalClientId: CLIENTE, parcelamentoId: PARC_ID, agora: AGORA });

    // Só a vencida volta para a fila; a futura não é "não paga", é "ainda não devida".
    expect(p.prestacoes.voltamParaFila).toBe(1);
    // ⚠ O risco é pedido como se o contrato JÁ estivesse ativo: é o que ele vai encontrar ao voltar.
    expect(p.riscoAoReativar).not.toBeNull();
  });
});

describe("⚠ a ausência deixou de ser muda — o predicado do aviso é o da fila, invertido", () => {
  const AGORA_FILA = new Date("2026-08-10T15:00:00.000Z");

  it("as CONDIÇÕES são idênticas; só o status do parcelamento muda", () => {
    const fila = whereParcelaSemGuiaPendente({ portalClientId: "c1", agora: AGORA_FILA });
    const fora = whereParcelaForaDaFilaPorRescisao({ portalClientId: "c1", agora: AGORA_FILA });

    const { parcelamento: naFila, ...condicoesDaFila } = fila;
    const { parcelamento: foraDaFila, ...condicoesDoAviso } = fora;
    // Se alguém mudar a janela, a coluna de quitação ou o filtro de guia numa das duas, o número do
    // aviso deixa de contar as MESMAS linhas que voltariam à fila — e a tela passa a mentir.
    expect(condicoesDoAviso).toEqual(condicoesDaFila);
    expect(naFila).toEqual({ is: { status: { not: "RESCINDIDO" } } });
    expect(foraDaFila).toEqual({ is: { status: "RESCINDIDO" } });
  });

  it("o aviso é POR CONTRATO, com a contagem — não 69 linhas repetidas", async () => {
    const { resumoForaDaFilaPorRescisao } = await import("../recalculoParcelamento.js");
    const parc = (id, label) => ({ id, label, tipo: "OUTRO", numeroParcelamento: "3", status: "RESCINDIDO" });
    const resumo = resumoForaDaFilaPorRescisao([
      { id: "a", parcelamentoId: "p1", parcelamento: parc("p1", "OUTRO Nº 3") },
      { id: "b", parcelamentoId: "p1", parcelamento: parc("p1", "OUTRO Nº 3") },
      { id: "c", parcelamentoId: "p2", parcelamento: parc("p2", "PARCSN Nº 1") },
    ]);

    expect(resumo.prestacoes).toBe(3);
    expect(resumo.contratos).toHaveLength(2);
    expect(resumo.contratos[0]).toMatchObject({ parcelamentoId: "p1", prestacoes: 2 });
    expect(resumo.motivo).toBe("PARCELAMENTO_RESCINDIDO");
  });

  it("lista vazia devolve o resumo VAZIO, não `null` — a fila precisa poder dizer 'não há nada'", () => {
    expect(resumoVazio()).toEqual({ prestacoes: 0, contratos: [], motivo: "PARCELAMENTO_RESCINDIDO" });
  });
});

function resumoVazio() {
  // eslint-disable-next-line global-require
  const { resumoForaDaFilaPorRescisao } = jest.requireActual("../recalculoParcelamento.js");
  return resumoForaDaFilaPorRescisao([]);
}

describe("AtoRecusado", () => {
  it("carrega um código estável para a rota traduzir em status HTTP", () => {
    const err = new AtoRecusado("MES_CORRENTE_FECHADO", "…", { competencia: "2026-08" });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("MES_CORRENTE_FECHADO");
    expect(err.competencia).toBe("2026-08");
  });
});
