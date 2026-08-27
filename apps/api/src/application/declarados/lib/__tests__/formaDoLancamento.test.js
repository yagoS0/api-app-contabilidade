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
    // ⚠ `conta` entrou na forma em 26/08/2026, e é aditivo: a trava de conta SINTÉTICA precisa de
    // `analitica` (para decidir) e de `nome` (para a recusa nomear a conta). O `toEqual` continua
    // estrito de propósito — é ele que denuncia campo entrando aqui sem motivo escrito.
    expect(i.get("111010001")).toEqual({
      reduzido: "5",
      ambiguo: false,
      conta: { codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" },
    });
    expect(i.get("411020008")).toEqual({
      reduzido: "464",
      ambiguo: false,
      conta: { codigo: "464", codigoCompleto: "411020008", nome: "SERVIÇOS PRESTADOS POR PJ" },
    });
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A TRAVA DE CONTA SINTÉTICA — que até aqui NÃO existia neste caminho.
//
// ⚠⚠ O gate vivia só em `POST/PUT /entries`. Confirmar na Conferência criava lançamento em conta de
// AGREGAÇÃO sem recusa nenhuma — e o estrago não aparece aqui: aparece na ENTREGA da ECD, meses
// depois, porque o registro I250 exige `IND_CTA = "A"` (analítica) e o PGE recusa o arquivo.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("conta sintética", () => {
  const sintetica = { codigo: "410", codigoCompleto: "411020000", nome: "DESPESAS OPERACIONAIS", analitica: false };

  it("RECUSA quando a conta da despesa é sintética", () => {
    const r = montarLancamento(declarado({ contaAplicada: "411020000" }), planoDe([sintetica]));
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(RECUSA_DA_FORMA.CONTA_SINTETICA);
    expect(r.entry).toBeNull();
  });

  it("a recusa NOMEIA o reduzido que o contador digitou, e cita o I250 e a saída", () => {
    const r = montarLancamento(declarado({ contaAplicada: "411020000" }), planoDe([sintetica]));
    // ⚠ o REDUZIDO (`410`), nunca o `codigoCompleto` — este último é âncora interna e o contador
    // não o vê em lugar nenhum da tela.
    expect(r.frase).toContain("410");
    expect(r.frase).toContain("DESPESAS OPERACIONAIS");
    expect(r.frase).toContain("I250");
    // ⚠⚠ Recusa muda é o defeito, não a recusa: ela tem de dizer o que fazer.
    expect(r.frase).toMatch(/analític/i);
    // e NÃO é o fallback estático
    expect(r.frase).not.toBe(FRASE_DA_RECUSA_DA_FORMA[RECUSA_DA_FORMA.CONTA_SINTETICA]);
  });

  // ⚠⚠ A PROVA DO TRI-ESTADO. Com `!analitica` no lugar de `=== false`, os três testes abaixo caem —
  // e em produção TODO plano ainda não reimportado viraria sintético, travando toda a contabilização.
  it("analitica NULA passa — conta sem codigoCompleto NÃO é sintética", () => {
    const conta = { codigo: "777", codigoCompleto: "411020077", nome: "NAO REIMPORTADA", analitica: null };
    const r = montarLancamento(declarado({ contaAplicada: "411020077" }), planoDe([conta]));
    expect(r.motivo).not.toBe(RECUSA_DA_FORMA.CONTA_SINTETICA);
    expect(r.ok).toBe(true);
  });

  it("analitica AUSENTE passa — é o plano de hoje, antes de a coluna ser preenchida", () => {
    // ⚠ `planoDe()` não declara `analitica` em nenhuma conta: é literalmente o estado de produção.
    const r = montarLancamento(declarado(), planoDe());
    expect(r.ok).toBe(true);
  });

  it("analitica TRUE passa", () => {
    const conta = { codigo: "888", codigoCompleto: "411020088", nome: "ANALITICA", analitica: true };
    const r = montarLancamento(declarado({ contaAplicada: "411020088" }), planoDe([conta]));
    expect(r.ok).toBe(true);
  });

  // ⚠ A ORDEM DAS RECUSAS É RESPOSTA, NÃO ARRUMAÇÃO: sem saber QUAL é a conta, não há o que afirmar
  // sobre ela. Chamar de "sintética" uma conta que nem está no plano mandaria o contador procurar
  // filha analítica de uma conta que não existe.
  it("FORA DO PLANO vence sintética", () => {
    const r = montarLancamento(declarado({ contaAplicada: "999999999" }), planoDe([sintetica]));
    expect(r.motivo).toBe(RECUSA_DA_FORMA.CONTA_FORA_DO_PLANO);
  });

  it("AMBÍGUA vence sintética", () => {
    const gemea = { codigo: "411", codigoCompleto: "411020000", nome: "OUTRA", analitica: false };
    const r = montarLancamento(declarado({ contaAplicada: "411020000" }), planoDe([sintetica, gemea]));
    expect(r.motivo).toBe(RECUSA_DA_FORMA.CONTA_AMBIGUA);
  });

  // ⚠ O caixa é CRAVADO, então sintética ali é PLANO TORTO, não escolha do contador — motivo
  // próprio, e a frase manda corrigir o plano em vez de mandar escolher outra conta.
  it("caixa SINTÉTICO recusa, com motivo PRÓPRIO e diferente do da despesa", () => {
    const caixaSintetico = { codigo: "5", codigoCompleto: CAIXA_CODIGO_COMPLETO, nome: "CAIXA", analitica: false };
    const plano = planoDe();
    plano.set("5", caixaSintetico);
    const r = montarLancamento(declarado(), plano);
    expect(r.motivo).toBe(RECUSA_DA_FORMA.CAIXA_SINTETICO);
    expect(RECUSA_DA_FORMA.CAIXA_SINTETICO).not.toBe(RECUSA_DA_FORMA.CONTA_SINTETICA);
    expect(r.frase).toMatch(/plano de contas/i);
  });

  // ⚠⚠ UMA AUTORIDADE SÓ. Um segundo predicado aqui divergiria do de `POST/PUT /entries` na primeira
  // correção, e a divergência apareceria como "a Conferência aceitou o que os Lançamentos recusam".
  it("REUSA o gate, não escreve um segundo predicado", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "formaDoLancamento.js"), "utf8");
    expect(fonte).toMatch(/from\s+["']\.\.\/\.\.\/accounting\/lib\/gateContaSintetica\.js["']/);
    const semComentario = fonte
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // nenhuma comparação de `analitica` escrita à mão neste arquivo
    expect(semComentario).not.toMatch(/analitica\s*===/);
    expect(semComentario).not.toMatch(/!\s*analitica/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A SENTINELA DO `select` — a TRAVA está a UMA LINHA de ficar cega, e nada segurava.
//
// Provado por sonda de um agente adversarial em 26/08/2026: passando um plano SEM a chave
// `analitica`, `montarLancamento` devolve `ok: true` para conta SINTÉTICA, **sem erro nenhum**. O
// predicado recebe `undefined` e responde `false` para toda conta. A única coisa que impede isso é
// uma linha do `select` de `AliquotaPorLancamentosService.carregarPlano` — que estava protegida
// só por comentário.
//
// É a classe do `legacyCompanySelect`, que este projeto já pagou TRÊS vezes. Os outros testes deste
// arquivo protegem COMO se compara; este protege DE ONDE VEM O DADO.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o `select` que alimenta a trava", () => {
  it("`carregarPlano` traz `analitica`", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "accounting", "AliquotaPorLancamentosService.js"),
      "utf8",
    );
    const selects = fonte.match(/select:\s*\{[^}]*codigoCompleto[^}]*\}/g) || [];
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) expect(s).toMatch(/analitica:\s*true/);
  });

  it("⚠ contraprova: o padrão da varredura reconhece a ausência", () => {
    const semColuna = "select: { portalClientId: true, codigo: true, nome: true, codigoCompleto: true },";
    expect(semColuna).not.toMatch(/analitica:\s*true/);
  });

  // ⚠⚠ E o comportamento com o plano cego fica CRAVADO, para ninguém achar que a trava sozinha
  // basta: sem a coluna, ela passa. Este teste documenta a dependência, não a aprova.
  it("⚠ plano SEM a coluna deixa a sintética passar — é por isso que a sentinela acima existe", () => {
    const cega = new Map([
      ["5", { codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" }],
      ["410", { codigo: "410", codigoCompleto: "411020000", nome: "DESPESAS OPERACIONAIS" }],
    ]);
    const r = montarLancamento(declarado({ contaAplicada: "411020000" }), cega);
    expect(r.ok).toBe(true);
  });
});
