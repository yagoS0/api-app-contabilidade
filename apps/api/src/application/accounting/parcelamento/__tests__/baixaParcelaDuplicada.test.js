// BAIXA DUPLICADA DA PARCELA — a guarda que era check-then-act FORA da transação.
//
// ⚠ O defeito: `gerarPagamentoParcelaFromGuide` verificava `guide.lancamentoId` e depois procurava
// uma BAIXA com o mesmo `sourceGuideId` — as duas leituras fora de qualquer transação — e só muito
// depois escrevia. Duas requisições simultâneas (duplo clique, ou o worker de confirmação de
// pagamento do SERPRO caindo no mesmo instante em que o contador clica "dar baixa") passavam AS
// DUAS pela verificação antes de qualquer uma escrever: dois lotes de lançamento amortizando o
// mesmo passivo pela mesma parcela.
//
// ⚠ E O BANCO NÃO SEGURAVA. O unique `(sourceGuideId, eventType)` existe, mas foi desenhado para as
// PROVISÕES (`GuideToProvisionService`, uma por tributo, cada uma com seu `eventType`). Os
// lançamentos de baixa da parcela nascem com `eventType` NULL, e no Postgres NULLs são DISTINTOS em
// UNIQUE — as duas linhas passam.
//
// A correção é uma RESERVA ATÔMICA da guia (`updateMany` condicional dentro da transação), o mesmo
// recurso que `GuideLockService` e `GuideLiberacaoService` já usam. O que estes testes verificam é
// que ela existe, que vem ANTES de qualquer escrita contábil e que desistir não deixa lançamento.
//
// ⚠ O QUE ESTES TESTES **NÃO** PROVAM: que o Postgres serializa as duas transações. Isso é o lock
// de linha do READ COMMITTED e só se exerce com banco de verdade e duas conexões — não há banco no
// ambiente de teste, e um mock não tem lock nenhum. O que se exerce aqui é a REAÇÃO à corrida
// perdida (contagem 0 → nenhum lançamento), que é a metade que mora no nosso código.

jest.mock("../../../../infrastructure/db/prisma.js", () => {
  const criados = [];
  const tx = {
    mapaContaTributo: { findFirst: jest.fn(async () => null) },
    accountingEntry: {
      create: jest.fn(async ({ data }) => {
        const entry = { id: `e${criados.length + 1}`, ...data, lines: data.lines?.createMany?.data || [] };
        criados.push(entry);
        return entry;
      }),
    },
    guide: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
  };
  return {
    __criados: criados,
    __tx: tx,
    prisma: {
      guide: { findFirst: jest.fn() },
      accountingEntry: { findFirst: jest.fn(async () => null) },
      parcelamento: { findUnique: jest.fn() },
      tributoParcela: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

jest.mock("../../fechamentoContabil.js", () => ({ isMonthClosed: jest.fn(async () => false) }));

import { prisma, __tx, __criados } from "../../../../infrastructure/db/prisma.js";
import { gerarPagamentoParcelaFromGuide } from "../ParcelamentoV2Service.js";

const GUIA = {
  id: "g1",
  parcelamentoId: "parc1",
  numeroParcela: 3,
  lancamentoId: null,
  competencia: "2026-07",
  vencimento: new Date("2026-07-20T00:00:00Z"),
};

const PARCELAMENTO = {
  id: "parc1", tipo: "PARCSN", kind: "SIMPLES", numParcelas: 60,
  aberturaEntryId: "abertura1", configPagamento: null,
};

// Uma parcela com as três naturezas — é o caso que produz mais de um lançamento no mesmo lote.
const TRIBUTOS = [
  { codigoTributo: "DAS", nomeTributo: "DAS", principal: 100, multa: 5, juros: 10, total: 115 },
];

beforeEach(() => {
  jest.clearAllMocks();
  __criados.length = 0;
  prisma.guide.findFirst.mockResolvedValue({ ...GUIA });
  prisma.accountingEntry.findFirst.mockResolvedValue(null);
  prisma.parcelamento.findUnique.mockResolvedValue({ ...PARCELAMENTO });
  prisma.tributoParcela.findMany.mockResolvedValue(TRIBUTOS);
  __tx.guide.updateMany.mockResolvedValue({ count: 1 });
});

async function baixar() {
  return gerarPagamentoParcelaFromGuide({
    portalClientId: "p1", guideId: "g1", dataPagamento: new Date("2026-07-18T00:00:00Z"),
  });
}

describe("reserva atômica da guia", () => {
  it("caminho normal: reserva a guia e lança o lote", async () => {
    const r = await baixar();
    expect(r.ok).toBe(true);
    // PARC (principal) + MULTA + JUROS + CAIXA = 4 lançamentos de uma perna só.
    expect(__criados).toHaveLength(4);
    expect(__tx.guide.updateMany).toHaveBeenCalledTimes(1);
    // A reserva só pega a guia que AINDA não tem lançamento — é este `where` que faz a corrida
    // perdida devolver 0. Sem `lancamentoId: null` o update casaria sempre e a trava não existiria.
    expect(__tx.guide.updateMany.mock.calls[0][0].where).toMatchObject({ id: "g1", lancamentoId: null });
  });

  it("⚠ a reserva vem ANTES do primeiro lançamento — depois já seria tarde", async () => {
    await baixar();
    const ordemReserva = __tx.guide.updateMany.mock.invocationCallOrder[0];
    const ordemPrimeiroLancamento = __tx.accountingEntry.create.mock.invocationCallOrder[0];
    expect(ordemReserva).toBeLessThan(ordemPrimeiroLancamento);
  });

  it("⚠ corrida perdida (reserva não pega a guia): NENHUM lançamento é criado", async () => {
    // É o que a segunda requisição vê depois que a primeira commitou: o `where` deixa de casar.
    __tx.guide.updateMany.mockResolvedValue({ count: 0 });
    const r = await baixar();
    expect(r).toEqual({ skipped: true, reason: "ja_baixada" });
    expect(__criados).toHaveLength(0);
    expect(__tx.guide.update).not.toHaveBeenCalled();
  });

  it("recusa não vira sucesso silencioso — devolve o motivo, não um ok vazio", async () => {
    __tx.guide.updateMany.mockResolvedValue({ count: 0 });
    const r = await baixar();
    expect(r.ok).toBeUndefined();
    expect(r.reason).toBe("ja_baixada");
  });
});

// ⚠ POR QUE NÃO HÁ ÍNDICE ÚNICO PARCIAL COBRINDO ISTO NO BANCO.
//
// Um índice único precisa de UMA linha por baixa para morder. Uma baixa de parcela são N
// lançamentos de uma perna só (principal, multa, juros, caixa — até um par por tributo do
// comprovante), e eles compartilham TODAS as colunas que identificariam a baixa. Qualquer índice
// único sobre essas colunas recusaria o SEGUNDO lançamento legítimo do mesmo lote, isto é,
// derrubaria a baixa inteira em vez de impedir a duplicada.
describe("a forma do lote (é o que decide o que o banco consegue impedir)", () => {
  it("os lançamentos do lote são indistinguíveis entre si nas colunas de AccountingEntry", async () => {
    await baixar();
    expect(__criados.length).toBeGreaterThan(1);
    const chave = (e) => JSON.stringify([
      e.sourceGuideId, e.tipo, e.subtipo, e.origem, e.loteImportacao,
      e.competencia, e.data, e.openEntryId, e.parcelamentoId, e.numeroParcela, e.eventType ?? null,
    ]);
    const chaves = new Set(__criados.map(chave));
    expect(chaves.size).toBe(1);
  });

  it("⚠ `eventType` nasce NULL em todos — é por isso que o unique (sourceGuideId, eventType) não morde", async () => {
    await baixar();
    for (const e of __criados) expect(e.eventType ?? null).toBeNull();
  });
});
