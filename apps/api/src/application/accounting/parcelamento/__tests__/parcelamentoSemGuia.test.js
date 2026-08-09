// F2.3 — PARCELAMENTO-FIRST: o contrato nasce sem guia nenhuma.
//
// ⚠ A INVERSÃO QUE ESTES TESTES TRAVAM. O parcelamento nascia como EFEITO COLATERAL de subir uma
// guia. Mas ele é um contrato de dívida que vive até 60 meses, e a guia é evidência MENSAL e
// OPCIONAL — ela não existe em débito automático, e não existe nas prestações de um acordo migrado
// de outra contabilidade. Um módulo que exige o documento para reconhecer o contrato não consegue
// representar nem um caso nem o outro.
//
// São três coisas exercidas aqui, e as três são escritas de verdade (nada é afirmado por leitura):
//
//   1. criar o contrato SEM `guideId`, com o cronograma inteiro materializado;
//   2. `diaPagamento` informado chegando ao cronograma — é ele que decide ATRASO quando não há guia,
//      e o modal nunca o coletava (por isso os contratos de produção vencem todos no dia 1);
//   3. `parcelasJaPagas` → prestações com `origemBaixa: "HISTORICO"`, que contam como QUITADAS e
//      NÃO como inadimplentes, e que **não geram lançamento nenhum**.
//
// ⚠ O ponto 3 é o mais delicado: `HISTORICO` não é estado novo. É uma palavra a mais no vocabulário
// de uma coluna que já existia (`parcelas.origemBaixa`) e que `parcelaRowQuitada` /
// `temEvidenciaDePagamento` já liam. Coluna nova daria uma segunda resposta para uma pergunta que já
// tem uma.

jest.mock("../../../../infrastructure/db/prisma.js", () => {
  const store = { parcelamentos: [], parcelas: [], entries: [], seq: 0 };

  const proximo = (p) => { store.seq += 1; return `${p}${store.seq}`; };

  // Filtro mínimo — só as formas que este fluxo realmente usa.
  function casa(row, where = {}) {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("lte" in v && !(row[k] != null && row[k] <= v.lte)) return false;
        if ("not" in v && v.not === null && row[k] == null) return false;
        if ("in" in v && !v.in.includes(row[k])) return false;
      } else if (row[k] !== v) return false;
    }
    return true;
  }

  const tx = {
    portalClient: { findUnique: jest.fn(async () => ({ razao: "EMPRESA TESTE", cnpj: "00000000000191" })) },
    // ⚠ Duas chamadas diferentes caem aqui: a busca por (cliente, tipo, número) na ingestão e a
    // releitura por id que `sincronizarParcelas` faz. O `where.id` é o que as separa.
    parcelamento: {
      findFirst: jest.fn(async ({ where }) => (where.id
        ? store.parcelamentos.find((p) => p.id === where.id) || null
        : store.parcelamentos.find((p) => p.tipo === where.tipo && p.numeroParcelamento === where.numeroParcelamento) || null)),
      create: jest.fn(async ({ data }) => {
        // O default do banco para `diaPagamento` é 1 — quando o payload não manda, é ele que vale.
        const p = { id: proximo("parc"), diaPagamento: 1, aberturaEntryId: null, ...data };
        store.parcelamentos.push(p);
        return p;
      }),
      update: jest.fn(async ({ where, data }) => {
        const p = store.parcelamentos.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
    },
    mapaContaTributo: { findFirst: jest.fn(async () => null) },
    accountingEntry: {
      create: jest.fn(async ({ data }) => {
        const e = { id: proximo("entry"), ...data, lines: data.lines?.createMany?.data || [] };
        store.entries.push(e);
        return e;
      }),
    },
    guide: { findMany: jest.fn(async () => []), update: jest.fn(async () => ({})) },
    tributoParcela: { upsert: jest.fn(async () => ({})) },
    parcela: {
      findMany: jest.fn(async ({ where }) => store.parcelas.filter((p) => casa(p, where))),
      create: jest.fn(async ({ data }) => {
        const p = { id: proximo("pcl"), guiaId: null, origemBaixa: null, baixadaEm: null, ...data };
        store.parcelas.push(p);
        return p;
      }),
      update: jest.fn(async ({ where, data }) => {
        const p = store.parcelas.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const alvo = store.parcelas.filter((p) => casa(p, where));
        alvo.forEach((p) => Object.assign(p, data));
        return { count: alvo.length };
      }),
    },
  };

  return {
    __store: store,
    prisma: { ...tx, $transaction: jest.fn(async (cb) => cb(tx)) },
  };
});

import { __store } from "../../../../infrastructure/db/prisma.js";
import { ingestParcelamentoFromGuide } from "../ParcelamentoV2Service.js";
import { buildDTOsFromManual } from "../entradaManual.js";
import { quadroDasParcelas } from "../recalculoParcelamento.js";
import { normalizeParcelamentoDTO } from "../contracts.js";

const HOJE = new Date("2026-08-09T12:00:00.000Z");

function limpar() {
  __store.parcelamentos.length = 0;
  __store.parcelas.length = 0;
  __store.entries.length = 0;
  __store.seq = 0;
}

/**
 * A ingestão como o "parcelamento-first" a usa: SEM guia, com o cabeçalho do contrato.
 * `guide: null` percorre `buildDTOsFromManual` inteiro — é ele o primeiro que teria de exigir guia.
 */
async function criarContrato(header, extra = {}) {
  const { parcelamentoDTO, parcelaDTO } = buildDTOsFromManual({ guide: null, header });
  return ingestParcelamentoFromGuide({
    portalClientId: "pc1", guideId: null, parcelamentoDTO, parcelaDTO, userId: "u1", ...extra,
  });
}

const HEADER = {
  tipo: "PARCSN",
  numeroParcelamento: "1234567",
  quantidadeParcelas: 60,
  valorPrincipal: 18000,
  valorTotal: 21000,
  anoMesParcela: "202601", // sem guia, a competência inicial TEM de vir do header
  diaPagamento: 15,
};

beforeEach(limpar);

// ─────────────────────────────────────────────────────────────────────────────
describe("criar o contrato SEM guia nenhuma", () => {
  test("nasce com o cronograma inteiro materializado, e nenhuma guia é exigida", async () => {
    const r = await criarContrato(HEADER);

    expect(r.ok).toBe(true);
    expect(r.criouParcelamento).toBe(true);
    expect(__store.parcelas).toHaveLength(60);
    expect(__store.parcelas.every((p) => p.guiaId == null)).toBe(true);

    // ⚠ "0 de 60", não "0 de 0": o denominador é o CONTRATO. E nenhuma prestação sem evidência
    // vira inadimplência — o risco fica não avaliável em vez de acender RESCINDÍVEL sozinho.
    const q = quadroDasParcelas(__store.parcelas, { agora: HOJE });
    expect(q.parcelasTotal).toBe(60);
    expect(q.parcelasPagas).toBe(0);
    expect(q.parcelasSemEvidencia).toBe(60);
    expect(q.risco.avaliavel).toBe(false);
    expect(q.risco.emAtraso).toBe(0);
  });

  test("a provisão sai com a forma de sempre: D principal / C parcelamento-a-pagar (só o principal)", async () => {
    await criarContrato(HEADER);

    // ⚠ DOIS lançamentos de UMA perna cada — a forma NÃO mudou nesta fase, e não pode mudar:
    // creditar o consolidado reconheceria o encargo duas vezes e deixaria resíduo no passivo.
    expect(__store.entries).toHaveLength(2);
    const debito = __store.entries.find((e) => e.tipoLinha === "PRINCIPAL");
    const credito = __store.entries.find((e) => e.tipoLinha === "PARC");
    expect(debito.lines[0]).toMatchObject({ tipo: "D", valor: 18000 });
    expect(credito.lines[0]).toMatchObject({ tipo: "C", valor: 18000 }); // principal, NÃO 21000
    expect(__store.entries.every((e) => e.tipo === "PROVISAO")).toBe(true);
  });

  test("saldoConsolidado é gravado e NÃO vira lançamento", async () => {
    await criarContrato({ ...HEADER, saldoConsolidado: 19750.42 });

    expect(Number(__store.parcelamentos[0].saldoConsolidado)).toBe(19750.42);
    // A soma dos créditos continua sendo o principal — o consolidado não entrou em perna nenhuma.
    const creditos = __store.entries.flatMap((e) => e.lines).filter((l) => l.tipo === "C");
    expect(creditos.reduce((s, l) => s + l.valor, 0)).toBe(18000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("diaPagamento — a data que decide atraso quando não há guia", () => {
  test("o dia informado chega ao cronograma", async () => {
    await criarContrato(HEADER); // diaPagamento: 15

    expect(__store.parcelamentos[0].diaPagamento).toBe(15);
    expect(__store.parcelas[0].vencimento.toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(__store.parcelas[1].vencimento.toISOString()).toBe("2026-02-15T12:00:00.000Z");
    expect(__store.parcelas[59].vencimento.toISOString()).toBe("2030-12-15T12:00:00.000Z");
  });

  test("⚠ ausente, o default do banco (dia 1) volta a valer — que é como os contratos antigos ficaram", async () => {
    const { diaPagamento, ...semDia } = HEADER;
    await criarContrato(semDia);

    expect(__store.parcelamentos[0].diaPagamento).toBe(1);
    expect(__store.parcelas[0].vencimento.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  test("o DTO clampa 1..31 em vez de deixar um dia impossível chegar ao cronograma", () => {
    expect(normalizeParcelamentoDTO({ diaPagamento: 40 }).diaPagamento).toBe(31);
    expect(normalizeParcelamentoDTO({ diaPagamento: 0 }).diaPagamento).toBe(1);
    // ⚠ Ausente vira `null`, não 1: quem grava é que decide o que fazer com a ausência. Devolver 1
    // aqui esconderia "não informado" atrás de um dia válido.
    expect(normalizeParcelamentoDTO({}).diaPagamento).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("parcelasJaPagas — quitadas ANTES de o contrato entrar no sistema", () => {
  test("marca N prestações como HISTORICO, e elas contam como pagas", async () => {
    const r = await criarContrato(HEADER, { parcelasJaPagas: 12 });

    expect(r.marcadasHistorico).toBe(12);
    const historicas = __store.parcelas.filter((p) => p.origemBaixa === "HISTORICO");
    expect(historicas.map((p) => p.numeroParcela)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const q = quadroDasParcelas(__store.parcelas, { agora: HOJE });
    expect(q.parcelasPagas).toBe(12);
    expect(q.parcelasTotal).toBe(60);
    expect(q.parcelasSemEvidencia).toBe(48);
  });

  test("⚠ HISTORICO NÃO conta como atraso — 12 vencidas e quitadas não rescindem nada", async () => {
    // As 12 primeiras venceram (jan–dez/2026 a partir de 2026-01) e estão marcadas como pagas.
    // Se `HISTORICO` não fosse lido como quitação, seriam 12 em atraso e o acordo sairia RESCINDÍVEL.
    await criarContrato(HEADER, { parcelasJaPagas: 12 });

    const q = quadroDasParcelas(__store.parcelas, { agora: HOJE });
    expect(q.risco.avaliavel).toBe(true); // há evidência: as 12
    expect(q.risco.emAtraso).toBe(0);
    expect(q.risco.nivel).toBe("ok");
  });

  test("⚠ NÃO gera lançamento nenhum: não houve pagamento NOSSO para lançar", async () => {
    await criarContrato(HEADER, { parcelasJaPagas: 12 });

    // Só os 2 lançamentos da provisão da adesão. Nenhuma BAIXA.
    expect(__store.entries).toHaveLength(2);
    expect(__store.entries.some((e) => e.tipo === "BAIXA")).toBe(false);
  });

  test("`baixadaEm` é gravada, e é a data da DECLARAÇÃO (a do pagamento não se sabe)", async () => {
    await criarContrato(HEADER, { parcelasJaPagas: 3 });
    const historicas = __store.parcelas.filter((p) => p.origemBaixa === "HISTORICO");
    expect(historicas).toHaveLength(3);
    expect(historicas.every((p) => p.baixadaEm instanceof Date)).toBe(true);
  });

  test("zero / ausente / negativo não marcam nada", async () => {
    const a = await criarContrato(HEADER);
    expect(a.marcadasHistorico).toBe(0);
    limpar();
    const b = await criarContrato(HEADER, { parcelasJaPagas: 0 });
    expect(b.marcadasHistorico).toBe(0);
    limpar();
    const c = await criarContrato(HEADER, { parcelasJaPagas: -5 });
    expect(c.marcadasHistorico).toBe(0);
    expect(__store.parcelas.every((p) => p.origemBaixa == null)).toBe(true);
  });

  test("⚠ não sobrescreve prestação que TEM guia: evidência real vence declaração de histórico", async () => {
    await criarContrato(HEADER);
    // A prestação 2 recebeu uma guia depois (recaptura do SERPRO, por exemplo).
    const comGuia = __store.parcelas.find((p) => p.numeroParcela === 2);
    comGuia.guiaId = "g2";

    const r = await criarContrato({ ...HEADER }, { parcelasJaPagas: 3 });

    expect(r.criouParcelamento).toBe(false); // mesmo (tipo, número): reanexou
    expect(comGuia.origemBaixa).toBeNull();
    expect(r.marcadasHistorico).toBe(2); // só as 1 e 3
  });

  test("idempotente: a reingestão não remarca o que já está marcado", async () => {
    await criarContrato(HEADER, { parcelasJaPagas: 12 });
    const r2 = await criarContrato(HEADER, { parcelasJaPagas: 12 });
    expect(r2.marcadasHistorico).toBe(0);
    expect(__store.parcelas.filter((p) => p.origemBaixa === "HISTORICO")).toHaveLength(12);
    expect(__store.parcelas).toHaveLength(60); // não duplicou o cronograma
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("formaPagamento — declaração, não inferência", () => {
  test("ausente = NÃO DECLARADO (null), e o comportamento segue o de hoje", async () => {
    await criarContrato(HEADER);
    expect(__store.parcelamentos[0].formaPagamento).toBeUndefined();
    expect(normalizeParcelamentoDTO({}).formaPagamento).toBeNull();
  });

  test("declarada, é gravada; valor fora do vocabulário vira NÃO DECLARADO em vez de derrubar a ingestão", async () => {
    await criarContrato({ ...HEADER, formaPagamento: "debito_automatico" });
    expect(__store.parcelamentos[0].formaPagamento).toBe("DEBITO_AUTOMATICO");
    // ⚠ O CHECK do banco recusaria uma string livre e derrubaria a ingestão inteira por um typo do
    // payload. O DTO absorve isso: desconhecido = não declarado.
    expect(normalizeParcelamentoDTO({ formaPagamento: "PIX" }).formaPagamento).toBeNull();
  });

  test("pode ser declarada DEPOIS, na reingestão do mesmo contrato", async () => {
    await criarContrato(HEADER);
    expect(__store.parcelamentos[0].formaPagamento).toBeUndefined();

    await criarContrato({ ...HEADER, formaPagamento: "GUIA_MENSAL", saldoConsolidado: 15000 });

    expect(__store.parcelamentos).toHaveLength(1);
    expect(__store.parcelamentos[0].formaPagamento).toBe("GUIA_MENSAL");
    expect(Number(__store.parcelamentos[0].saldoConsolidado)).toBe(15000);
  });
});
