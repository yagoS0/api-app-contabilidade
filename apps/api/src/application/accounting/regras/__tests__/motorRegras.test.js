// O MOTOR DE VERIFICAÇÃO — os pares REAIS do balancete do sistema de destino (Nasajon), fornecido
// pelo dono em 24/08/2026, e os defeitos medidos em produção no mesmo dia.
//
// ⚠ Nada aqui é exemplo inventado: cada par corresponde a um movimento do balancete ou a um
// lançamento que existe na base.

import { REGRA, SITUACAO } from "../contratos.js";
import { baseDeIncidencia, verificarLancamento, verificarLote } from "../MotorRegras.js";

// ── O plano de contas real, na parte que importa ────────────────────────────────────────────────
const PLANO = {
  // retificadoras de receita (3.3.1.03)
  418: { codigo: "418", codigoCompleto: "331030004", nome: "(-) ISS" },
  419: { codigo: "419", codigoCompleto: "331030005", nome: "(-) PIS" },
  420: { codigo: "420", codigoCompleto: "331030006", nome: "(-) COFINS" },
  557: { codigo: "557", codigoCompleto: "331030009", nome: "(-) DAS- SIMPLES NACIONAL" },
  // despesas tributárias (4.1.1.03) — onde IRPJ e CSLL debitam
  499: { codigo: "499", codigoCompleto: "411030005", nome: "CONTRIBUICAO SOCIAL" },
  544: { codigo: "544", codigoCompleto: "411030006", nome: "IRPJ" },
  // obrigações tributárias (2.1.1.05)
  250: { codigo: "250", codigoCompleto: "211050001", nome: "IRPJ A RECOLHER" },
  253: { codigo: "253", codigoCompleto: "211050004", nome: "ISS A RECOLHER" },
  254: { codigo: "254", codigoCompleto: "211050005", nome: "PIS A RECOLHER" },
  255: { codigo: "255", codigoCompleto: "211050006", nome: "COFINS A RECOLHER" },
  256: { codigo: "256", codigoCompleto: "211050007", nome: "CSLL A RECOLHER" },
  265: { codigo: "265", codigoCompleto: "211050016", nome: "DAS - SIMPLES NACIONAL A RECOLHER" },
  553: { codigo: "553", codigoCompleto: "211050027", nome: "PARCELAMENTO SIMPLES A RECOLHER" },
  // ramo 5 — existe no plano e o sistema de destino NÃO usa
  594: { codigo: "594", codigoCompleto: "511010001", nome: "(-) IRPJ" },
  595: { codigo: "595", codigoCompleto: "511010002", nome: "(-) CSLL" },
  // ATIVO, sob INCENTIVOS FISCAIS — o erro relatado pelo dono
  136: { codigo: "136", codigoCompleto: "121060002", nome: "IRPJ" },
  137: { codigo: "137", codigoCompleto: "121060003", nome: "CSLL" },
  // ⚠ obrigações TRABALHISTAS (2.1.1.04) — é onde mora o INSS
  240: { codigo: "240", codigoCompleto: "211040009", nome: "INSS A PAGAR" },
  242: { codigo: "242", codigoCompleto: "211040011", nome: "FGTS A PAGAR" },
  // ⚠ despesas FINANCEIRAS (4.1.1.04) — as pernas de acréscimo da baixa
  501: { codigo: "501", codigoCompleto: "411040001", nome: "JUROS" },
  506: { codigo: "506", codigoCompleto: "411040006", nome: "MULTAS" },
  // disponibilidade
  5: { codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" },
  // conta sem código completo (existe na base: 13 contas)
  900: { codigo: "900", codigoCompleto: null, nome: "CONTA SEM COMPLETO" },
};
const resolverConta = (c) => PLANO[String(c)] || null;

const lanc = (tipo, eventType, contaD, contaC, extra = {}) => ({
  id: `${eventType}-${contaD}-${contaC}`,
  tipo,
  eventType,
  lines: [
    ...(contaD == null ? [] : [{ conta: String(contaD), tipo: "D", valor: 100 }]),
    ...(contaC == null ? [] : [{ conta: String(contaC), tipo: "C", valor: 100 }]),
  ],
  ...extra,
});
const ver = (l) => verificarLancamento({ lancamento: l, resolverConta, empresaId: "emp-1" });

describe("baseDeIncidencia — sobre a receita ou sobre o lucro", () => {
  it("ISS, PIS, COFINS e DAS incidem sobre a RECEITA", () => {
    for (const e of ["DARF_ISS", "DARF_PIS", "DARF_COFINS", "DAS_SIMPLES", "ISS", "SIMPLES"]) {
      expect(baseDeIncidencia({ eventType: e })).toBe("RECEITA");
    }
  });

  it("IRPJ e CSLL incidem sobre o LUCRO", () => {
    for (const e of ["DARF_IRPJ", "DARF_CSLL", "IRPJ", "CSLL"]) {
      expect(baseDeIncidencia({ eventType: e })).toBe("LUCRO");
    }
  });

  it("⚠ PIS_COFINS é o subtipo LEGADO e incide sobre a receita — 11 registros na base", () => {
    expect(baseDeIncidencia({ subtipo: "PIS_COFINS" })).toBe("RECEITA");
  });

  it("o eventType vence o subtipo, e sem os dois a resposta é null (não é acusação)", () => {
    expect(baseDeIncidencia({ eventType: "DARF_IRPJ", subtipo: "PIS" })).toBe("LUCRO");
    expect(baseDeIncidencia({})).toBeNull();
    expect(baseDeIncidencia({ eventType: "DARF_OUTROS" })).toBeNull();
  });
});

describe("⚠⚠ OS PARES DO BALANCETE PASSAM — provisões", () => {
  it.each([
    ["ISS", "DARF_ISS", 418, 253],
    ["PIS", "DARF_PIS", 419, 254],
    ["COFINS", "DARF_COFINS", 420, 255],
    ["DAS", "DAS_SIMPLES", 557, 265],
    ["IRPJ", "DARF_IRPJ", 544, 250],
    ["CSLL", "DARF_CSLL", 499, 256],
  ])("provisão de %s (%s): D %s / C %s", (_n, ev, d, c) => {
    const r = ver(lanc("PROVISAO", ev, d, c));
    expect(r.achados).toEqual([]);
    expect(r.situacao).toBe(SITUACAO.OK);
  });
});

describe("⚠⚠ OS PAGAMENTOS DO BALANCETE PASSAM", () => {
  it.each([
    ["DAS", "DAS_SIMPLES", 265],
    ["ISS", "DARF_ISS", 253],
    ["PIS", "DARF_PIS", 254],
    ["COFINS", "DARF_COFINS", 255],
  ])("pagamento de %s: D %s / C caixa", (_n, ev, d) => {
    const r = ver(lanc("BAIXA", ev, d, 5));
    expect(r.achados).toEqual([]);
    expect(r.situacao).toBe(SITUACAO.OK);
  });

  it("pagamento de parcela de parcelamento também passa (debita o passivo do parcelamento)", () => {
    expect(ver(lanc("BAIXA", "DAS_SIMPLES", 553, 5)).situacao).toBe(SITUACAO.OK);
  });

  it("⚠ pagamento creditando algo que não é caixa acusa", () => {
    const r = ver(lanc("BAIXA", "DARF_PIS", 254, 419));
    expect(r.situacao).toBe(SITUACAO.VIOLA);
    expect(r.achados[0].regraId).toBe(REGRA.PAGAMENTO_FORMA);
    expect(r.achados[0].esperado).toBe("1.1.1.*");
  });
});

// ⚠⚠ ESTE BLOCO INTEIRO NASCEU DE FALSO POSITIVO MEDIDO EM PRODUÇÃO. A primeira versão do motor
// exigia débito de pagamento em `21105*` e acusou **31 lançamentos corretos**. Rodar o diagnóstico
// contra a base real ANTES de ligar a tela foi o que pegou isso — e é por isso que estes casos são
// testes, não comentários.
describe("⚠⚠ AS FORMAS LEGÍTIMAS QUE O MOTOR ACUSOU POR ENGANO — e não pode voltar a acusar", () => {
  it("pagamento de INSS debita 2.1.1.04 (obrigação TRABALHISTA), não 2.1.1.05", () => {
    const r = ver(lanc("BAIXA", "INSS", 240, 5));
    expect(r.achados).toEqual([]);
    expect(r.situacao).toBe(SITUACAO.OK);
  });

  it("pagamento de FGTS idem", () => {
    expect(ver(lanc("BAIXA", "FGTS", 242, 5)).situacao).toBe(SITUACAO.OK);
  });

  it("⚠ a perna de JUROS da baixa debita 4.1.1.04 — a baixa é TRÊS lançamentos neste projeto", () => {
    expect(ver(lanc("BAIXA", "DAS_SIMPLES", 501, 5)).situacao).toBe(SITUACAO.OK);
  });

  it("⚠ a perna de MULTA idem", () => {
    expect(ver(lanc("BAIXA", "DAS_SIMPLES", 506, 5)).situacao).toBe(SITUACAO.OK);
  });

  it("⚠ provisão de tributo NÃO IDENTIFICADO creditando obrigação trabalhista passa", () => {
    // Sem saber qual tributo é, não dá para descartar INSS/FGTS, que creditam 2.1.1.04.
    expect(ver(lanc("PROVISAO", "DARF_OUTROS", 419, 240)).situacao).toBe(SITUACAO.OK);
  });

  it("⚠⚠ mas tributo IDENTIFICADO creditando trabalhista CONTINUA acusando", () => {
    // CSLL creditando INSS A PAGAR é erro, e afrouxar aqui apagaria a regra inteira.
    const r = ver(lanc("PROVISAO", "DARF_CSLL", 499, 240));
    expect(r.situacao).toBe(SITUACAO.VIOLA);
    expect(r.achados[0].regraId).toBe(REGRA.IRPJ_CSLL_CONTRAPARTIDA_PASSIVO);
  });
});

describe("⚠ a BAIXA com a forma INVERTIDA é nomeada como estorno, não como duas contas erradas", () => {
  it("D caixa / C obrigação marcado como BAIXA", () => {
    const r = ver(lanc("BAIXA", "DAS_SIMPLES", 5, 265));
    expect(r.situacao).toBe(SITUACAO.VIOLA);
    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].mensagem).toContain("estorno");
  });
});

describe("⚠⚠ F3.01 — o de-para errado do import: IRPJ/CSLL no ramo 5", () => {
  it("CSLL debitando 5.1.1.01.0002 acusa, mesmo com o crédito CERTO", () => {
    const r = ver(lanc("PROVISAO", "DARF_CSLL", 595, 256));
    expect(r.situacao).toBe(SITUACAO.VIOLA);
    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].regraId).toBe(REGRA.IRPJ_CSLL_DEBITO);
    expect(r.achados[0].perna).toBe("D");
    expect(r.achados[0].esperado).toBe("4.1.1.03.*");
    expect(r.achados[0].mensagem).toContain("5.1.1.01.0002");
  });

  it("IRPJ debitando 5.1.1.01.0001 acusa igual", () => {
    const r = ver(lanc("PROVISAO", "DARF_IRPJ", 594, 250));
    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].regraId).toBe(REGRA.IRPJ_CSLL_DEBITO);
  });

  it("⚠⚠ IRPJ debitando RETIFICADORA também acusa — IRPJ não é dedução de receita", () => {
    const r = ver(lanc("PROVISAO", "DARF_IRPJ", 419, 250));
    expect(r.achados[0].regraId).toBe(REGRA.IRPJ_CSLL_DEBITO);
    expect(r.achados[0].esperado).toBe("4.1.1.03.*");
  });

  it("⚠ e PIS debitando a MESMA retificadora continua passando — a regra do IRPJ não a 'conserta'", () => {
    expect(ver(lanc("PROVISAO", "DARF_PIS", 419, 254)).situacao).toBe(SITUACAO.OK);
  });

  it("⚠ o inverso: PIS debitando despesa tributária acusa", () => {
    const r = ver(lanc("PROVISAO", "DARF_PIS", 544, 254));
    expect(r.achados[0].regraId).toBe(REGRA.TRIBUTO_RECEITA_DEBITO);
    expect(r.achados[0].esperado).toBe("3.3.1.03.*");
  });
});

describe("⚠⚠ F9.01 — O CASO RELATADO PELO DONO: provisão creditando ATIVO", () => {
  it("CSLL D 595 / C 137 acusa OS DOIS erros, com os dois esperados", () => {
    const r = ver(lanc("PROVISAO", "DARF_CSLL", 595, 137));
    expect(r.situacao).toBe(SITUACAO.VIOLA);
    expect(r.achados).toHaveLength(2);
    const porRegra = Object.fromEntries(r.achados.map((a) => [a.regraId, a]));
    expect(porRegra[REGRA.IRPJ_CSLL_DEBITO].esperado).toBe("4.1.1.03.*");
    expect(porRegra[REGRA.IRPJ_CSLL_CONTRAPARTIDA_PASSIVO].esperado).toBe("2.1.1.05.*");
    expect(porRegra[REGRA.IRPJ_CSLL_CONTRAPARTIDA_PASSIVO].mensagem).toContain("1.2.1.06.0003");
  });

  it("IRPJ D 594 / C 136 idem", () => {
    const r = ver(lanc("PROVISAO", "DARF_IRPJ", 594, 136));
    expect(r.achados).toHaveLength(2);
  });

  it("o crédito CERTO com o débito certo não acusa nada", () => {
    expect(ver(lanc("PROVISAO", "DARF_CSLL", 499, 256)).achados).toEqual([]);
  });
});

describe("F9.02 — provisão com forma de PAGAMENTO (4 casos medidos)", () => {
  it("D obrigação / C caixa marcado como PROVISAO acusa a FORMA, não duas contas", () => {
    const r = ver(lanc("PROVISAO", "DAS_SIMPLES", 265, 5));
    expect(r.situacao).toBe(SITUACAO.VIOLA);
    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].regraId).toBe(REGRA.PROVISAO_COM_FORMA_DE_PAGAMENTO);
  });
});

describe("⚠ F9.03 — parcelamento é CONFERIR, nunca VIOLA (7 casos medidos)", () => {
  it("D 553 (parcelamento) / C 265 sai como CONFERIR", () => {
    const r = ver(lanc("PROVISAO", "DAS_SIMPLES", 553, 265));
    expect(r.situacao).toBe(SITUACAO.CONFERIR);
    expect(r.achados[0].regraId).toBe(REGRA.PARCELAMENTO_COM_FORMA_DE_PROVISAO);
    expect(r.achados[0].severidade).toBe("SUGESTAO");
  });

  it("⚠ e NÃO é acusado como débito errado — a mensagem fala de mover dívida", () => {
    const r = ver(lanc("PROVISAO", "DAS_SIMPLES", 553, 265));
    expect(r.achados.map((a) => a.regraId)).not.toContain(REGRA.DAS_DEBITO);
  });
});

describe("⚠⚠ INDETERMINADO nunca é violação", () => {
  it("as duas pernas sem conta", () => {
    const r = ver({ id: "x", tipo: "PROVISAO", eventType: "DAS_SIMPLES", lines: [{ conta: "", tipo: "D", valor: 1 }, { conta: "", tipo: "C", valor: 1 }] });
    expect(r.situacao).toBe(SITUACAO.INDETERMINADO);
    expect(r.achados).toEqual([]);
  });

  it("conta fora do plano", () => {
    expect(ver(lanc("PROVISAO", "DARF_PIS", 7777, 8888)).situacao).toBe(SITUACAO.INDETERMINADO);
  });

  it("conta do plano SEM codigoCompleto", () => {
    expect(ver(lanc("PROVISAO", "DARF_PIS", 900, 900)).situacao).toBe(SITUACAO.INDETERMINADO);
  });

  it("⚠ UMA perna só é julgada normalmente — é o desenho deste sistema desde a Q52", () => {
    expect(ver(lanc("PROVISAO", "DARF_PIS", 419, null)).situacao).toBe(SITUACAO.OK);
    expect(ver(lanc("PROVISAO", "DARF_PIS", null, 254)).situacao).toBe(SITUACAO.OK);
    expect(ver(lanc("PROVISAO", "DARF_CSLL", 595, null)).situacao).toBe(SITUACAO.VIOLA);
  });

  it("⚠ PARCELAMENTO tem regra própria, em outro lugar — não é julgado aqui", () => {
    const r = ver(lanc("PROVISAO", "DAS_SIMPLES", 595, 137, { parcelamentoId: "p1" }));
    expect(r.situacao).toBe(SITUACAO.INDETERMINADO);
    expect(r.motivo).toBe("lancamento_de_parcelamento");
    expect(r.achados).toEqual([]);
  });

  it("⚠ tipo fora do catálogo (RECEITA, DESPESA, FOLHA) não é julgado", () => {
    for (const t of ["RECEITA", "DESPESA", "FOLHA", "OUTRO"]) {
      expect(ver(lanc(t, "DARF_PIS", 595, 137)).situacao).toBe(SITUACAO.INDETERMINADO);
    }
  });
});

describe("tributo não identificado — a regra genérica é mais frouxa DE PROPÓSITO", () => {
  it("retificadora e despesa tributária ambas passam", () => {
    expect(ver(lanc("PROVISAO", "DARF_OUTROS", 419, 254)).situacao).toBe(SITUACAO.OK);
    expect(ver(lanc("PROVISAO", "DARF_OUTROS", 544, 250)).situacao).toBe(SITUACAO.OK);
  });

  it("⚠ mas o crédito em ATIVO continua sendo pego", () => {
    const r = ver(lanc("PROVISAO", "DARF_OUTROS", 419, 137));
    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].regraId).toBe(REGRA.TRIBUTO_CONTRAPARTIDA_PASSIVO);
  });
});

describe("verificarLote — o relatório agrupado por REGRA", () => {
  const lote = [
    lanc("PROVISAO", "DAS_SIMPLES", 557, 265),   // ok
    lanc("PROVISAO", "DARF_PIS", 419, 254),      // ok
    lanc("PROVISAO", "DARF_CSLL", 595, 256),     // viola (débito ramo 5)
    lanc("PROVISAO", "DARF_IRPJ", 594, 250),     // viola (débito ramo 5)
    lanc("PROVISAO", "DARF_CSLL", 595, 137),     // viola x2
    lanc("PROVISAO", "DAS_SIMPLES", 553, 265),   // conferir
    lanc("PROVISAO", "DARF_PIS", 900, 900),      // indeterminado
  ];
  const r = () => verificarLote({ lancamentos: lote, resolverConta, empresaId: "emp-1" });

  it("o resumo conta cada situação", () => {
    expect(r().resumo).toMatchObject({ total: 7, ok: 2, viola: 3, conferir: 1, indeterminado: 1 });
  });

  it("⚠⚠ porRegra agrupa e ordena pelo que mais aparece — é o que permite corrigir em lote", () => {
    const g = r().porRegra;
    expect(g[0]).toMatchObject({ regraId: REGRA.IRPJ_CSLL_DEBITO, n: 3 });
    expect(g[0].exemplos.length).toBeGreaterThan(0);
    expect(g[0].lancamentos).toHaveLength(3);
  });

  it("nunca para no primeiro achado — todos os lançamentos entram em porLancamento", () => {
    expect(r().porLancamento).toHaveLength(7);
  });

  it("⚠ o override suprime pelo hash e devolve o lançamento a OK, contando o suprimido", () => {
    const semOverride = r();
    const hash = semOverride.porLancamento.find((l) => l.achados.length === 1
      && l.achados[0].regraId === REGRA.IRPJ_CSLL_DEBITO).achados[0].hash;
    const com = verificarLote({ lancamentos: lote, resolverConta, empresaId: "emp-1", overrides: [hash] });
    expect(com.resumo.suprimidos).toBeGreaterThan(0);
    expect(com.resumo.viola).toBeLessThan(semOverride.resumo.viola);
  });

  it("⚠ o hash NÃO depende do valor nem da data — o override vale no mês seguinte", () => {
    const a = ver(lanc("PROVISAO", "DARF_CSLL", 595, 256));
    const b = verificarLancamento({
      lancamento: { ...lanc("PROVISAO", "DARF_CSLL", 595, 256), lines: [{ conta: "595", tipo: "D", valor: 99999 }, { conta: "256", tipo: "C", valor: 99999 }] },
      resolverConta, empresaId: "emp-1",
    });
    expect(a.achados[0].hash).toBe(b.achados[0].hash);
  });

  it("lote vazio ou nulo não explode", () => {
    expect(verificarLote({ lancamentos: null, resolverConta }).resumo.total).toBe(0);
  });
});

// ⚠ VARREDURA DA FONTE, não teste de comportamento: um dublê passaria. Molde de
// `application/notas/auditoria/__tests__/auditoriaNaoEscreve.test.js`.
// ⚠ `__dirname` e não `import.meta` — o jest desta API roda em CommonJS.
describe("⚠ o motor e a família não escrevem nada", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  // ⚠ OS COMENTÁRIOS SAEM ANTES DE CASAR. A primeira versão desta varredura acusou
  // `contratos.js` por causa da frase que EXPLICA por que não se usa `Date.now()` — ou seja,
  // acusou justamente o comentário que documenta a regra. Varredura de fonte tem de olhar
  // código, senão ela proíbe escrever sobre o que proíbe.
  const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ler = (arq) => semComentarios(fs.readFileSync(path.join(__dirname, "..", arq), "utf8"));

  it.each(["MotorRegras.js", "familiaDaConta.js", "contratos.js"])("%s é puro", (arq) => {
    const fonte = ler(arq);
    expect(fonte).not.toMatch(/require\(["'].*prisma|from\s+["'][^"']*prisma/i);
    expect(fonte).not.toMatch(/\.(create|update|upsert|deleteMany|updateMany)\(/);
    expect(fonte).not.toMatch(/\$transaction/);
  });

  it("⚠ e não usam relógio — hash com Date.now nunca casaria com um override", () => {
    for (const arq of ["MotorRegras.js", "contratos.js"]) {
      expect(ler(arq)).not.toMatch(/Date\.now\(|new Date\(/);
    }
  });
});
