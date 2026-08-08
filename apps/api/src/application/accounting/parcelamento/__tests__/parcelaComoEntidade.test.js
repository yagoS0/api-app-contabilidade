// F2.1 — A PARCELA COMO ENTIDADE: o que estes testes travam.
//
// ⚠ O DEFEITO CENTRAL. `decorateParcelamento` decidia a versão do parcelamento com
// `isV2 = parcelas.length === 0 && guides.length > 0`. O segundo termo fazia a VERSÃO depender de
// quantas GUIAS já tinham chegado — então um parcelamento V2 sem guia nenhuma caía no ramo V1,
// contava linhas de rastreio que o V2 nunca cria, e reportava "0 de 0" com o risco de rescisão
// marcado como não avaliável. E "sem guia nenhuma" não é caso raro: é o DÉBITO AUTOMÁTICO (onde
// guia não existe por definição) e é todo parcelamento criado pelo caminho SERPRO, que
// `ingestParcelamentoFromGuide` aceita rodar sem `guideId`.
//
// ⚠ E O DEFEITO GÊMEO, mais silencioso: numerador e denominador vinham de fontes diferentes. Um
// acordo de 52 prestações com 3 guias capturadas aparecia como "1 de 3" — o denominador era o
// número de documentos que chegaram, não o de prestações contratadas.
//
// ⚠ O QUE ESTES TESTES TAMBÉM PROTEGEM, e é a decisão mais delicada da fase: prestação SEM
// EVIDÊNCIA não conta como inadimplida. Materializar o cronograma e passar as prestações sem guia
// como `quitada: false` acenderia RESCINDÍVEL em todo parcelamento em débito automático —
// inadimplência derivada de ausência de dado. Elas ficam fora do risco e viajam nomeadas em
// `parcelasSemEvidencia`.

import fs from "node:fs";
import path from "node:path";

import { quadroDasParcelas, parcelaRowQuitada, temEvidenciaDePagamento } from "../recalculoParcelamento.js";
import { sincronizarParcelas, calendarioDaParcela } from "../parcelaSync.js";

const HOJE = new Date("2026-08-08T12:00:00.000Z");
const VENCIDA = (d) => new Date(d);

function parcela({ n, vencimento, guia = null, origemBaixa = null }) {
  return { id: `p${n}`, numeroParcela: n, vencimento: vencimento ? VENCIDA(vencimento) : null, origemBaixa, guia };
}
function guiaPaga(vencimento) {
  return { id: `g`, vencimento: VENCIDA(vencimento), paymentStatus: "PAID", baixada: true };
}
function guiaEmAberto(vencimento) {
  return { id: `g`, vencimento: VENCIDA(vencimento), paymentStatus: "OPEN", baixada: false };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("quadroDasParcelas — numerador e denominador da MESMA fonte", () => {
  test("52 prestações contratadas e NENHUMA guia: 0 de 52, não 0 de 0", () => {
    const parcelas = Array.from({ length: 52 }, (_, i) =>
      parcela({ n: i + 1, vencimento: `2024-01-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z` }));

    const q = quadroDasParcelas(parcelas, { agora: HOJE });

    expect(q.parcelasTotal).toBe(52);
    expect(q.parcelasPagas).toBe(0);
    expect(q.parcelasSemEvidencia).toBe(52);
  });

  test("⚠ prestação sem evidência NÃO vira inadimplência: 52 vencidas sem guia não rescindem nada", () => {
    // Todas vencidas há mais de um ano. Se `quitada:false` fosse assumido, seriam 52 em atraso e o
    // acordo sairia RESCINDÍVEL — um alerta vermelho em todo débito automático saudável.
    const parcelas = Array.from({ length: 52 }, (_, i) =>
      parcela({ n: i + 1, vencimento: `2024-0${(i % 9) + 1}-15T12:00:00Z` }));

    const q = quadroDasParcelas(parcelas, { agora: HOJE });

    expect(q.risco.avaliavel).toBe(false);
    expect(q.risco.nivel).toBe("ok");
    expect(q.risco.emAtraso).toBe(0);
  });

  test("com 3 guias entre 52 prestações, o denominador continua sendo o CONTRATO", () => {
    const parcelas = [
      parcela({ n: 1, vencimento: "2026-05-20T12:00:00Z", guia: guiaPaga("2026-05-20T12:00:00Z") }),
      parcela({ n: 2, vencimento: "2026-06-20T12:00:00Z", guia: guiaPaga("2026-06-20T12:00:00Z") }),
      parcela({ n: 3, vencimento: "2026-07-20T12:00:00Z", guia: guiaEmAberto("2026-07-20T12:00:00Z") }),
      ...Array.from({ length: 49 }, (_, i) => parcela({ n: i + 4, vencimento: null })),
    ];

    const q = quadroDasParcelas(parcelas, { agora: HOJE });

    expect(q.parcelasPagas).toBe(2);
    expect(q.parcelasTotal).toBe(52); // ⚠ antes: 3 (o número de guias)
    expect(q.parcelasSemEvidencia).toBe(49);
    // Só a nº 3 venceu sem pagamento entre as que têm evidência.
    expect(q.risco.avaliavel).toBe(true);
    expect(q.risco.emAtraso).toBe(1);
    expect(q.risco.nivel).toBe("atencao");
  });

  test("débito automático: baixa registrada SEM guia (`origemBaixa`) quita a prestação", () => {
    const parcelas = [
      parcela({ n: 1, vencimento: "2026-05-20T12:00:00Z", origemBaixa: "DEBITO_AUTOMATICO" }),
      parcela({ n: 2, vencimento: "2026-06-20T12:00:00Z", origemBaixa: "DEBITO_AUTOMATICO" }),
      parcela({ n: 3, vencimento: "2026-07-20T12:00:00Z" }),
    ];

    const q = quadroDasParcelas(parcelas, { agora: HOJE });

    expect(q.parcelasPagas).toBe(2);
    expect(q.parcelasTotal).toBe(3);
    expect(q.parcelasSemEvidencia).toBe(1);
    expect(q.risco.emAtraso).toBe(0); // a nº 3 não tem evidência — não é "em atraso"
  });

  test("a REGRA de rescisão não foi reescrita: 3 prestações vencidas com guia não paga = rescindível", () => {
    const parcelas = [1, 2, 3].map((n) =>
      parcela({ n, vencimento: `2026-0${n + 3}-20T12:00:00Z`, guia: guiaEmAberto(`2026-0${n + 3}-20T12:00:00Z`) }));

    const q = quadroDasParcelas(parcelas, { agora: HOJE });

    expect(q.risco.nivel).toBe("rescindivel");
    expect(q.risco.caso).toBe("I");
    expect(q.risco.regra.id).toBe("IN_RFB_2063_2022_ART_18");
    expect(q.risco.regra.citacaoConferida).toBe(false);
  });

  test("parcelamento RESCINDIDO não é avaliado", () => {
    const q = quadroDasParcelas([parcela({ n: 1, vencimento: "2024-01-10T12:00:00Z" })], { status: "RESCINDIDO", agora: HOJE });
    expect(q.risco).toBeNull();
    expect(q.parcelasTotal).toBe(1);
  });

  test("o vencimento REAL da guia vence o cronograma contratado", () => {
    // Contrato dizia 20/06; a guia do SERPRO veio com 20/09 (ainda a vencer). Não pode contar atraso.
    const p = parcela({ n: 1, vencimento: "2026-06-20T12:00:00Z", guia: guiaEmAberto("2026-09-20T12:00:00Z") });
    const q = quadroDasParcelas([p], { agora: HOJE });
    expect(q.risco.vencidas).toBe(0);
    expect(q.risco.emAtraso).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("predicados", () => {
  test("parcelaRowQuitada delega à guia (não copia o estado dela)", () => {
    expect(parcelaRowQuitada({ guia: { paymentStatus: "PAID" } })).toBe(true);
    expect(parcelaRowQuitada({ guia: { baixada: true } })).toBe(true);
    expect(parcelaRowQuitada({ guia: { paymentStatus: "OPEN", baixada: false } })).toBe(false);
    expect(parcelaRowQuitada({ guia: null })).toBe(false);
    expect(parcelaRowQuitada({ guia: null, origemBaixa: "DEBITO_AUTOMATICO" })).toBe(true);
  });

  test("sem guia e sem baixa registrada = SEM EVIDÊNCIA (nem quitada, nem inadimplida)", () => {
    expect(temEvidenciaDePagamento({ guia: null, origemBaixa: null })).toBe(false);
    expect(temEvidenciaDePagamento({ guia: { id: "g" } })).toBe(true);
    expect(temEvidenciaDePagamento({ guia: null, origemBaixa: "MANUAL" })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("calendário contratado", () => {
  test("avança um mês por prestação e clampa ao último dia do mês", () => {
    const parc = { competenciaInicial: "2026-01", diaPagamento: 31 };
    expect(calendarioDaParcela(parc, 1).competencia).toBe("2026-01");
    expect(calendarioDaParcela(parc, 2).competencia).toBe("2026-02");
    // 31 de fevereiro não existe — vira 28 (2026 não é bissexto).
    expect(calendarioDaParcela(parc, 2).vencimento.toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(calendarioDaParcela(parc, 13).competencia).toBe("2027-01");
  });

  test("⚠ '1970-01' é SENTINELA, não data: o cronograma sai sem datas", () => {
    // `ingestParcelamentoFromGuide` grava `compLabel || "1970-01"`. Derivar vencimentos daí
    // marcaria o acordo inteiro como vencido em 1970 — e imprimiria uma sentinela como se fosse
    // data de vencimento de tributo.
    const cal = calendarioDaParcela({ competenciaInicial: "1970-01", diaPagamento: 10 }, 5);
    expect(cal.competencia).toBeNull();
    expect(cal.vencimento).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A MIGRAÇÃO PRESERVA O VÍNCULO COM OS LANÇAMENTOS
//
// ⚠ O vínculo contábil vive em `Guide.lancamentoId` e em `accounting_entries.sourceGuideId`.
// Perdê-lo é perder a conciliação já feita. A garantia tem DUAS pernas, e as duas são exercidas:
//   (1) ESTRUTURAL — a migration não escreve nessas tabelas. Verificado lendo o SQL.
//   (2) ALCANCE — nenhuma guia de parcelamento fica sem parcela apontando para ela, senão as
//       derivações (que agora leem `parcelas`) deixariam de enxergar uma baixa já conciliada.
//       Verificado exercendo o gêmeo em JS do backfill.
// ─────────────────────────────────────────────────────────────────────────────
describe("migration — o vínculo com os lançamentos não pode se perder", () => {
  // `__dirname` e não `import.meta.url`: o jest deste repo transpila os testes para CJS (babel),
  // onde `import.meta` não existe.
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../../../../prisma/migrations/20260808180000_add_parcela/migration.sql"),
    "utf8",
  );
  // Remove comentários: eles CITAM as tabelas o tempo todo ao explicar por que não as tocam.
  const codigo = sql.replace(/^\s*--.*$/gm, "");

  test("nenhum UPDATE/DELETE em \"Guide\" — `lancamentoId` fica intacto", () => {
    expect(codigo).not.toMatch(/UPDATE\s+"Guide"/i);
    expect(codigo).not.toMatch(/DELETE\s+FROM\s+"Guide"/i);
    expect(codigo).not.toMatch(/ALTER\s+TABLE\s+"Guide"/i);
  });

  test("nenhum UPDATE/DELETE em \"accounting_entries\" — `sourceGuideId` fica intacto", () => {
    expect(codigo).not.toMatch(/UPDATE\s+"accounting_entries"/i);
    expect(codigo).not.toMatch(/DELETE\s+FROM\s+"accounting_entries"/i);
    expect(codigo).not.toMatch(/ALTER\s+TABLE\s+"accounting_entries"/i);
  });

  test("a migration ABORTA se alguma guia de parcelamento ficar sem parcela", () => {
    expect(codigo).toMatch(/RAISE EXCEPTION/);
    expect(codigo).toMatch(/NOT EXISTS \(SELECT 1 FROM "parcelas" pa WHERE pa\."guiaId" = g\."id"\)/);
  });

  test("apagar a guia não apaga a prestação contratada (SET NULL, nunca CASCADE)", () => {
    expect(codigo).toMatch(/parcelas_guiaId_fkey[\s\S]*?REFERENCES "Guide"\("id"\) ON DELETE SET NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("sincronizarParcelas — o gêmeo em JS do backfill", () => {
  function fakeClient({ parcelamento, guias = [], parcelas = [] }) {
    const linhas = [...parcelas];
    let seq = linhas.length;
    return {
      linhas,
      parcelamento: { findFirst: async () => parcelamento },
      parcela: {
        findMany: async () => linhas.map((l) => ({ id: l.id, numeroParcela: l.numeroParcela, guiaId: l.guiaId })),
        create: async ({ data }) => {
          seq += 1;
          const nova = { id: `np${seq}`, guiaId: null, ...data };
          linhas.push(nova);
          return nova;
        },
        update: async ({ where, data }) => {
          const alvo = linhas.find((l) => l.id === where.id);
          Object.assign(alvo, data);
          return alvo;
        },
      },
      guide: { findMany: async () => guias },
    };
  }

  const PARC = {
    id: "parc1", portalClientId: "pc1", numParcelas: 5,
    competenciaInicial: "2026-01", diaPagamento: 20,
    valorParcelaReferencia: 300, principalPerParcela: 300,
  };

  test("materializa o cronograma inteiro mesmo sem NENHUMA guia (débito automático)", async () => {
    const c = fakeClient({ parcelamento: PARC });
    const r = await sincronizarParcelas(c, { portalClientId: "pc1", parcelamentoId: "parc1" });
    expect(r.criadas).toBe(5);
    expect(c.linhas.map((l) => l.numeroParcela)).toEqual([1, 2, 3, 4, 5]);
    expect(c.linhas.every((l) => l.guiaId == null)).toBe(true);
  });

  test("casa cada guia numerada com a sua prestação", async () => {
    const guias = [
      { id: "g2", numeroParcela: 2, competencia: "2026-02", anoMesParcela: "202602", vencimento: null, valor: 300 },
      { id: "g4", numeroParcela: 4, competencia: "2026-04", anoMesParcela: "202604", vencimento: null, valor: 300 },
    ];
    const c = fakeClient({ parcelamento: PARC, guias });
    const r = await sincronizarParcelas(c, { portalClientId: "pc1", parcelamentoId: "parc1" });
    expect(r.vinculadas).toBe(2);
    expect(c.linhas.find((l) => l.numeroParcela === 2).guiaId).toBe("g2");
    expect(c.linhas.find((l) => l.numeroParcela === 4).guiaId).toBe("g4");
  });

  test("⚠ NENHUMA GUIA FICA DE FORA: número acima do contrato e guia sem número ganham linha própria", async () => {
    // É a invariante que a asserção da migration cobra no banco. Guia órfã aqui = baixa conciliada
    // que some da contagem, porque as derivações passaram a ler `parcelas`.
    const guias = [
      { id: "g1", numeroParcela: 1, competencia: "2026-01", anoMesParcela: "202601", vencimento: null, valor: 300 },
      { id: "g99", numeroParcela: 99, competencia: "2030-01", anoMesParcela: "203001", vencimento: null, valor: 300 },
      { id: "gsemA", numeroParcela: null, competencia: "2026-06", anoMesParcela: "202606", vencimento: null, valor: 300 },
      { id: "gsemB", numeroParcela: null, competencia: "2026-07", anoMesParcela: "202607", vencimento: null, valor: 300 },
    ];
    const c = fakeClient({ parcelamento: PARC, guias });
    await sincronizarParcelas(c, { portalClientId: "pc1", parcelamentoId: "parc1" });

    const vinculadas = new Set(c.linhas.map((l) => l.guiaId).filter(Boolean));
    for (const g of guias) expect(vinculadas.has(g.id)).toBe(true);

    // ⚠ Duas guias SEM número precisam de DUAS linhas — casá-las com a mesma descartaria a segunda.
    const semNumero = c.linhas.filter((l) => l.numeroParcela == null);
    expect(semNumero).toHaveLength(2);
    expect(semNumero.map((l) => l.guiaId).sort()).toEqual(["gsemA", "gsemB"]);
  });

  test("idempotente: rodar de novo não cria nem revincula nada", async () => {
    const guias = [{ id: "g2", numeroParcela: 2, competencia: "2026-02", anoMesParcela: "202602", vencimento: null, valor: 300 }];
    const c = fakeClient({ parcelamento: PARC, guias });
    await sincronizarParcelas(c, { portalClientId: "pc1", parcelamentoId: "parc1" });
    const antes = c.linhas.length;
    const r2 = await sincronizarParcelas(c, { portalClientId: "pc1", parcelamentoId: "parc1" });
    expect(r2.criadas).toBe(0);
    expect(r2.vinculadas).toBe(0);
    expect(c.linhas.length).toBe(antes);
  });
});
