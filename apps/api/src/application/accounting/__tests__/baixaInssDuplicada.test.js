// BAIXA DUPLICADA DO INSS — a guarda que era check-then-act FORA da transação.
//
// ⚠ O defeito (o mesmo de `gerarPagamentoParcelaFromGuide`, ver
// `parcelamento/__tests__/baixaParcelaDuplicada.test.js`): `gerarPagamentoInssFromGuide`
// verificava `guide.lancamentoId || guide.baixada` e depois procurava uma BAIXA com o mesmo
// `sourceGuideId` — as duas leituras fora de qualquer transação — e só muito depois escrevia. Duas
// requisições simultâneas (duplo clique, ou o worker `SerproPaymentConfirmationService` caindo no
// mesmo instante em que o contador clica "dar baixa") passavam AS DUAS pela verificação antes de
// qualquer uma escrever: dois lotes de lançamento amortizando o mesmo passivo pela mesma guia.
//
// ⚠ E O BANCO NÃO SEGURAVA. O unique `(sourceGuideId, eventType)` existe, mas foi desenhado para as
// PROVISÕES (`GuideToProvisionService`, uma por tributo, cada uma com seu `eventType`). Os
// lançamentos de baixa do INSS nascem com `eventType` NULL — só o do principal carregaria o campo,
// e mesmo esse é nulo aqui — e no Postgres NULLs são DISTINTOS em UNIQUE: as duas linhas passam.
//
// A correção é uma RESERVA ATÔMICA da guia (`updateMany` condicional dentro da transação), o mesmo
// recurso que `GuideLockService` e `GuideLiberacaoService` já usam. O que estes testes verificam é
// que ela existe, que vem ANTES de qualquer escrita contábil e que desistir não deixa lançamento.
//
// ⚠ O QUE ESTES TESTES **NÃO** PROVAM: que o Postgres serializa as duas transações. Isso é o lock
// de linha do READ COMMITTED e só se exerce com banco de verdade e duas conexões — não há banco no
// ambiente de teste, e um mock não tem lock nenhum. O que se exerce aqui é a REAÇÃO à corrida
// perdida (contagem 0 → nenhum lançamento), que é a metade que mora no nosso código.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const criados = [];
  const tx = {
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
      accountingEntry: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      chartOfAccount: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

jest.mock("../fechamentoContabil.js", () => ({ isMonthClosed: jest.fn(async () => false) }));

import { prisma, __tx, __criados } from "../../../infrastructure/db/prisma.js";
import { gerarPagamentoInssFromGuide } from "../InssPagamentoService.js";

const VENCIMENTO = new Date("2026-07-20T00:00:00Z");
const EM_ATRASO = new Date("2026-08-04T00:00:00Z");

const GUIA = {
  id: "g1", tipo: "INSS", competencia: "2026-06", valor: 1000,
  lancamentoId: null, baixada: false, vencimento: VENCIMENTO,
};

// Com os três papéis a baixa sai em TRÊS lançamentos — é o caso que mostra que a reserva precede o
// lote inteiro, não só o primeiro create.
const RATEIO = { principal: 800, juros: 120, multa: 80 };

beforeEach(() => {
  jest.clearAllMocks();
  __criados.length = 0;
  prisma.guide.findFirst.mockResolvedValue({ ...GUIA });
  prisma.accountingEntry.findFirst.mockResolvedValue(null);
  __tx.guide.updateMany.mockResolvedValue({ count: 1 });
});

async function baixar(extra = {}) {
  return gerarPagamentoInssFromGuide({
    portalClientId: "p1", guideId: "g1", dataPagamento: EM_ATRASO, rateio: RATEIO, ...extra,
  });
}

describe("reserva atômica da guia", () => {
  it("caminho normal: reserva a guia e lança o lote", async () => {
    const r = await baixar();
    expect(r.ok).toBe(true);
    expect(__criados).toHaveLength(3); // principal + juros + multa
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

  // O lançamento único (pago em dia, sem acréscimo a separar) é o OUTRO ramo da transação, e ele
  // também precisa da reserva — foi por lá que a maioria das baixas de INSS passou.
  it("o ramo do lançamento ÚNICO também reserva antes de criar", async () => {
    __tx.guide.updateMany.mockResolvedValue({ count: 0 });
    const r = await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: new Date("2026-07-18T00:00:00Z"),
    });
    expect(r).toEqual({ skipped: true, reason: "ja_baixada" });
    expect(__criados).toHaveLength(0);
  });
});

// A FORMA DO LOTE — a premissa que decide o que o banco consegue impedir.
//
// Um índice único precisa de UMA linha por baixa para morder. Uma baixa de INSS em atraso são até
// três lançamentos (principal, juros, multa), e nas colunas ANTIGAS eles compartilham tudo o que
// identificaria a baixa. Um índice em `sourceGuideId` sozinho recusaria o SEGUNDO lançamento
// legítimo do mesmo lote — derrubaria a baixa inteira em vez de impedir a duplicada. Estes dois
// testes prendem essa premissa: é ela que explica por que o índice tem a forma que tem.
describe("a forma do lote (é o que decide o que o banco consegue impedir)", () => {
  it("os lançamentos do lote são indistinguíveis entre si nas colunas ANTIGAS de AccountingEntry", async () => {
    await baixar();
    expect(__criados.length).toBeGreaterThan(1);
    const chave = (e) => JSON.stringify([
      e.sourceGuideId, e.tipo, e.subtipo, e.origem, e.loteImportacao,
      e.competencia, e.data, e.eventType ?? null,
    ]);
    const chaves = new Set(__criados.map(chave));
    expect(chaves.size).toBe(1);
  });

  it("⚠ `eventType` nasce NULL em todos — é por isso que o unique (sourceGuideId, eventType) não morde", async () => {
    await baixar();
    for (const e of __criados) expect(e.eventType ?? null).toBeNull();
  });
});

// ⚠ O QUE DESTRAVOU O ÍNDICE: o PAPEL da linha subiu para o cabeçalho.
//
// `tipoLinha` já existia em `AccountingEntryLine` (Q21) e agora existe também em
// `accounting_entries`. Com ele, a chave (`sourceGuideId`, `tipoLinha`,
// `COALESCE("codigoTributo",'')`) SEPARA os três lançamentos legítimos do mesmo lote e REPETE nos
// três de uma segunda baixa da mesma guia — que é exatamente o que um índice único precisa.
//
// ⚠ O `COALESCE` não é enfeite: aqui `codigoTributo` é NULL (a guia de INSS é de um tributo só), e
// sem ele os NULLs voltariam a ser distintos em UNIQUE — a mesma armadilha do `eventType`.
//
// ⚠ E o `tipoLinha` é COBRADO pelo banco: `CHECK chk_baixa_tipo_linha` recusa BAIXA sem papel. Um
// caminho que esqueça de preencher não falha aqui (não há banco no teste) — falha em PRODUÇÃO.
const chaveDoIndice = (e) => JSON.stringify([e.sourceGuideId, e.tipoLinha, e.codigoTributo ?? ""]);

describe("a chave composta separa o lote legítimo e repete na duplicada", () => {
  it("toda baixa nasce com tipoLinha (senão o CHECK do banco derruba o lote inteiro)", async () => {
    await baixar();
    expect(__criados).toHaveLength(3);
    for (const e of __criados) expect(e.tipoLinha).toBeTruthy();
    expect(__criados.map((e) => e.tipoLinha)).toEqual(["PRINCIPAL", "JUROS", "MULTA"]);
  });

  it("⚠ as três chaves do MESMO lote são DISTINTAS — o índice não recusa baixa legítima", async () => {
    await baixar();
    const chaves = new Set(__criados.map(chaveDoIndice));
    expect(chaves.size).toBe(__criados.length);
  });

  it("⚠ a segunda baixa da mesma guia REPETE as chaves — é isso que o índice pega", async () => {
    await baixar();
    const primeiroLote = __criados.map(chaveDoIndice);
    await baixar(); // a reserva atômica está mockada em `count: 1`; aqui interessa só a chave
    const segundoLote = __criados.slice(primeiroLote.length).map(chaveDoIndice);
    expect(segundoLote).toEqual(primeiroLote);
  });

  it("o ramo do lançamento ÚNICO (pago em dia) também nasce com papel — e é o principal", async () => {
    await gerarPagamentoInssFromGuide({
      portalClientId: "p1", guideId: "g1", dataPagamento: new Date("2026-07-18T00:00:00Z"),
    });
    expect(__criados).toHaveLength(1);
    expect(__criados[0].tipoLinha).toBe("PRINCIPAL");
  });
});
