// A FORMA DO LANÇAMENTO QUE O DECLARADO VIRA.
//
// ⚠⚠ ESTE ARQUIVO É A ÂNCORA DA MEDIÇÃO. Os valores conferidos aqui não foram escolhidos: saíram de
// `scripts/diag-forma-despesa.mjs` contra produção em 24/08/2026, sobre os 155 lançamentos
// `tipo: "DESPESA"` que já existem. Mudar qualquer um deles é mudar a forma do lançamento contábil
// desta casa — o que exige pedido explícito do dono, não uma decisão de implementação.

import {
  CAIXA_CODIGO_COMPLETO,
  FRASE_DA_RECUSA_DA_FORMA,
  ORIGEM_DO_LANCAMENTO,
  RECUSA_DA_FORMA,
  indicePorCodigoCompleto,
  montarLancamento,
} from "../formaDoLancamento";

const DIA = new Date("2026-07-15T00:00:00.000Z");

/** O plano REAL, na parte que importa — os reduzidos e completos medidos em produção. */
const planoDe = (extra = []) =>
  new Map(
    [
      { codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" },
      { codigo: "464", codigoCompleto: "411020008", nome: "SERVIÇOS PRESTADOS POR PJ" },
      { codigo: "566", codigoCompleto: "411020039", nome: "DESPESAS COM REFEIÇOES" },
      // ⚠ 13 contas da base não têm código completo. Elas não podem entrar no índice.
      { codigo: "999", codigoCompleto: null, nome: "SEM CODIGO COMPLETO" },
      ...extra,
    ].map((c) => [c.codigo, c]),
  );

const declarado = (extra = {}) => ({
  portalClientId: "emp-1",
  competencia: "2026-07",
  dataPagamento: DIA,
  dataDocumento: new Date("2026-07-02T00:00:00.000Z"),
  descricaoOriginal: "KODA BEAR",
  valor: 1500,
  valorAjustado: null,
  contaAplicada: "411020008",
  ...extra,
});

describe("⚠⚠ A FORMA MEDIDA — 155 de 155 em produção", () => {
  const { ok, entry } = montarLancamento(declarado(), planoDe());

  it("monta", () => expect(ok).toBe(true));

  it("é 1D / 1C — partida dobrada completa, nunca perna única", () => {
    expect(entry.lines.create).toHaveLength(2);
    expect(entry.lines.create.map((l) => l.tipo)).toEqual(["D", "C"]);
  });

  it("⚠⚠ o CRÉDITO é o CAIXA, e o débito é a conta escolhida", () => {
    expect(entry.lines.create[0]).toMatchObject({ conta: "464", tipo: "D", valor: 1500 });
    expect(entry.lines.create[1]).toMatchObject({ conta: "5", tipo: "C", valor: 1500 });
  });

  it("⚠⚠ a LINHA guarda o REDUZIDO, o declarado guarda o COMPLETO", () => {
    // `AccountingEntryLine.conta` é TEXTO sem FK e guarda o reduzido; o completo é a âncora
    // imutável. A ponte entre os dois existe num lugar só.
    expect(entry.lines.create.map((l) => l.conta)).toEqual(["464", "5"]);
    expect(CAIXA_CODIGO_COMPLETO).toBe("111010001");
  });

  it("⚠⚠ `eventType` é NULO — é o que deixa N notas conviverem na mesma competência", () => {
    // Existe um UNIQUE PARCIAL (portalClientId, competencia, eventType, origem) WHERE tipo<>'BAIXA'.
    // Com eventType preenchido, a SEGUNDA nota do mês estouraria P2002 em produção.
    expect(entry.eventType).toBeNull();
    expect(entry.subtipo).toBeNull();
  });

  it("o cabeçalho é o medido", () => {
    expect(entry).toMatchObject({
      tipo: "DESPESA",
      status: "RASCUNHO",
      statusPagamento: "NA",
      competencia: "2026-07",
    });
  });

  it("⚠ `origem` é CONFERENCIA — procedência própria, distinta de MANUAL e EXCEL", () => {
    expect(entry.origem).toBe(ORIGEM_DO_LANCAMENTO);
    expect(ORIGEM_DO_LANCAMENTO).toBe("CONFERENCIA");
  });

  it("⚠ o HISTÓRICO é a descrição crua — o formato que os 130 do Excel já usam", () => {
    expect(entry.historico).toBe("KODA BEAR");
  });
});

describe("⚠⚠ A DATA DO LANÇAMENTO É A DO PAGAMENTO", () => {
  it("nunca a do documento", () => {
    const { entry } = montarLancamento(declarado(), planoDe());
    expect(entry.data).toBe(DIA);
    expect(entry.data).not.toEqual(new Date("2026-07-02T00:00:00.000Z"));
  });

  it("sem data de pagamento NÃO monta — o crédito vai ao caixa, a data É a afirmação", () => {
    const r = montarLancamento(declarado({ dataPagamento: null }), planoDe());
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(RECUSA_DA_FORMA.SEM_DATA_DE_PAGAMENTO);
    expect(r.entry).toBeNull();
  });

  it("data inválida recusa igual", () => {
    for (const d of [undefined, "2026-07-15", new Date("banana"), 0]) {
      expect(montarLancamento(declarado({ dataPagamento: d }), planoDe()).motivo)
        .toBe(RECUSA_DA_FORMA.SEM_DATA_DE_PAGAMENTO);
    }
  });
});

describe("⚠ competência", () => {
  it("NULA não monta — não se deduz o mês da apuração", () => {
    const r = montarLancamento(declarado({ competencia: null }), planoDe());
    expect(r.motivo).toBe(RECUSA_DA_FORMA.SEM_COMPETENCIA);
    expect(r.frase).toMatch(/apuração/i);
  });

  it("⚠ e NÃO é preenchida a partir da data de pagamento", () => {
    // A tentação é `data.toISOString().slice(0,7)`. Seria o sistema decidindo em qual apuração a
    // despesa entra — exatamente o que a auditoria de notas já se recusa a fazer.
    const r = montarLancamento(declarado({ competencia: "  " }), planoDe());
    expect(r.ok).toBe(false);
  });
});

describe("a conta da despesa", () => {
  it("conta fora do plano da empresa recusa NOMEANDO isso", () => {
    const r = montarLancamento(declarado({ contaAplicada: "411029999" }), planoDe());
    expect(r.motivo).toBe(RECUSA_DA_FORMA.CONTA_FORA_DO_PLANO);
  });

  it("⚠ conta vazia recusa — conta em branco jamais vira lançamento", () => {
    for (const c of [null, "", "   ", undefined]) {
      expect(montarLancamento(declarado({ contaAplicada: c }), planoDe()).motivo)
        .toBe(RECUSA_DA_FORMA.SEM_CONTA);
    }
  });

  it("⚠⚠ DUAS contas com o mesmo código completo: o sistema NÃO escolhe", () => {
    const plano = planoDe([{ codigo: "888", codigoCompleto: "411020008", nome: "OUTRA" }]);
    expect(montarLancamento(declarado(), plano).motivo).toBe(RECUSA_DA_FORMA.CONTA_AMBIGUA);
  });
});

describe("⚠ a conta de CAIXA", () => {
  it("empresa sem a conta de caixa recusa, e a frase diz qual é", () => {
    const semCaixa = new Map([...planoDe()].filter(([cod]) => cod !== "5"));
    const r = montarLancamento(declarado(), semCaixa);
    expect(r.motivo).toBe(RECUSA_DA_FORMA.CAIXA_FORA_DO_PLANO);
    expect(r.frase).toMatch(/1\.1\.1\.01\.0001/);
  });

  it("⚠⚠ caixa ambíguo também recusa — nunca 'o primeiro que achar'", () => {
    const plano = planoDe([{ codigo: "6", codigoCompleto: "111010001", nome: "CAIXA 2" }]);
    expect(montarLancamento(declarado(), plano).motivo).toBe(RECUSA_DA_FORMA.CAIXA_AMBIGUO);
  });

  it("⚠ o caixa é resolvido pelo COMPLETO, não pelo reduzido 5", () => {
    // Numa empresa em que o reduzido 5 é outra coisa e o caixa é o 7, o lançamento tem de creditar
    // o 7. Cravar "5" funcionaria hoje e erraria em silêncio no dia da renumeração.
    const plano = new Map([
      ["7", { codigo: "7", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" }],
      ["5", { codigo: "5", codigoCompleto: "411020099", nome: "OUTRA COISA" }],
      ["464", { codigo: "464", codigoCompleto: "411020008", nome: "SERVIÇOS PJ" }],
    ]);
    const { entry } = montarLancamento(declarado(), plano);
    expect(entry.lines.create[1].conta).toBe("7");
  });
});

describe("valor", () => {
  it("⚠ `valorAjustado` vence o valor do documento", () => {
    const { entry } = montarLancamento(declarado({ valorAjustado: 900 }), planoDe());
    expect(entry.lines.create[0].valor).toBe(900);
    expect(entry.lines.create[1].valor).toBe(900);
  });

  it("⚠ `valorAjustado` NULO cai no valor, não em zero", () => {
    const { entry } = montarLancamento(declarado({ valorAjustado: null }), planoDe());
    expect(entry.lines.create[0].valor).toBe(1500);
  });

  it("⚠⚠ zero, negativo e lixo recusam — lançamento de R$ 0,00 já aconteceu nesta casa", () => {
    for (const v of [0, -5, "abc", null, undefined, NaN]) {
      expect(montarLancamento(declarado({ valor: v, valorAjustado: null }), planoDe()).motivo)
        .toBe(RECUSA_DA_FORMA.VALOR_INVALIDO);
    }
  });

  it("⚠ os dois lados têm o MESMO valor — D = C, sempre", () => {
    const { entry } = montarLancamento(declarado({ valor: 33.33 }), planoDe());
    const [d, c] = entry.lines.create;
    expect(d.valor).toBe(c.valor);
  });
});

describe("histórico", () => {
  it("vazio recusa", () => {
    for (const h of [null, "", "   "]) {
      expect(montarLancamento(declarado({ descricaoOriginal: h }), planoDe()).motivo)
        .toBe(RECUSA_DA_FORMA.SEM_HISTORICO);
    }
  });
});

describe("indicePorCodigoCompleto", () => {
  it("inverte o plano", () => {
    const i = indicePorCodigoCompleto(planoDe());
    expect(i.get("111010001")).toEqual({ reduzido: "5", ambiguo: false });
    expect(i.get("411020008")).toEqual({ reduzido: "464", ambiguo: false });
  });

  it("⚠ conta SEM código completo não entra — 13 da base estão assim", () => {
    const i = indicePorCodigoCompleto(planoDe());
    expect([...i.values()].map((v) => v.reduzido)).not.toContain("999");
  });

  it("⚠ duplicata marca ambíguo, e o primeiro reduzido é PRESERVADO para a mensagem", () => {
    const i = indicePorCodigoCompleto(planoDe([{ codigo: "888", codigoCompleto: "411020008" }]));
    expect(i.get("411020008").ambiguo).toBe(true);
  });

  it("⚠ o MESMO reduzido repetido não é ambiguidade — é a mesma conta", () => {
    const plano = new Map([["5", { codigo: "5", codigoCompleto: "111010001" }]]);
    expect(indicePorCodigoCompleto(plano).get("111010001").ambiguo).toBe(false);
  });

  it("entrada torta não explode", () => {
    expect(indicePorCodigoCompleto(null).size).toBe(0);
    expect(indicePorCodigoCompleto(new Map([["x", null]])).size).toBe(0);
  });
});

describe("os vocabulários", () => {
  it("⚠ TODA recusa tem frase", () => {
    for (const m of Object.values(RECUSA_DA_FORMA)) {
      expect(typeof FRASE_DA_RECUSA_DA_FORMA[m]).toBe("string");
      expect(FRASE_DA_RECUSA_DA_FORMA[m].length).toBeGreaterThan(10);
    }
  });

  it("são congelados", () => {
    expect(Object.isFrozen(RECUSA_DA_FORMA)).toBe(true);
    expect(Object.isFrozen(FRASE_DA_RECUSA_DA_FORMA)).toBe(true);
  });
});

describe("⚠ o módulo é PURO", () => {
  it("não importa prisma e não lê o relógio", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "formaDoLancamento.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fonte).not.toMatch(/from\s+["'].*prisma/i);
    expect(fonte).not.toMatch(/Date\.now\(/);
    expect(fonte).not.toMatch(/new Date\(\s*\)/);
  });
});
