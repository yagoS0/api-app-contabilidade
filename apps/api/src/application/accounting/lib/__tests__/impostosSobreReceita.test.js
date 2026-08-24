// A ALÍQUOTA EFETIVA POR LANÇAMENTO — regra pura.
//
// ⚠ Os códigos completos usados aqui são os REAIS do plano de contas de produção, medidos em
// 24/08/2026 (`scripts/diag-aliquota-lp-lancamentos.mjs`). Não são exemplos: é contra eles que a
// classificação por prefixo tem de valer.

import {
  GRUPO,
  SITUACAO,
  aliquotaEfetivaDeLancamentos,
  classificarConta,
  somarComponentes,
} from "../impostosSobreReceita.js";

const conta = (codigoCompleto, codigo, nome) => ({ codigoCompleto, codigo, nome });

// As contas reais que as provisões do Lucro Presumido usam hoje.
const RECEITA_SERVICOS = conta("311020007", "372", "DEMAIS RECEITAS DE PRESTAÇÃO DE SERVICOS - MATRIZ");
const MENOS_ISS = conta("331030004", "418", "(-) ISS");
const MENOS_PIS = conta("331030005", "419", "(-) PIS");
const MENOS_COFINS = conta("331030006", "420", "(-) COFINS");
const MENOS_IRPJ = conta("511010001", "594", "(-) IRPJ");
const MENOS_CSLL = conta("511010002", "595", "(-) CSLL");

describe("classificarConta — o prefixo do codigoCompleto decide, nunca o nome", () => {
  it("311* é receita bruta", () => {
    expect(classificarConta(conta("311010001"))).toBe(GRUPO.RECEITA_BRUTA);
    expect(classificarConta(RECEITA_SERVICOS)).toBe(GRUPO.RECEITA_BRUTA);
    expect(classificarConta(conta("311"))).toBe(GRUPO.RECEITA_BRUTA);
  });

  it("33103* (IMPOSTOS INCIDENTES) é imposto sobre a receita — as nove contas do grupo", () => {
    for (const cc of [
      "331030001", // (-) ICMS
      "331030002", // (-) IPI
      "331030003", // (-) ICMS ST RETIDO
      "331030004", // (-) ISS
      "331030005", // (-) PIS
      "331030006", // (-) COFINS
      "331030007", // (-) ISS RETIDO (NAO RECUPERAVEL)
      "331030008", // (-) INSS S/RECEITA LEI 12.546/2011  ← CPRB: incide sobre RECEITA
      "331030009", // (-) DAS - SIMPLES NACIONAL
    ]) {
      expect(classificarConta(conta(cc))).toBe(GRUPO.IMPOSTO_SOBRE_RECEITA);
    }
  });

  it("⚠ devolução e desconto são deduções, NÃO impostos — apesar de irmãs de 33103", () => {
    expect(classificarConta(conta("331010004"))).toBe(GRUPO.DEDUCAO_NAO_TRIBUTARIA); // devoluções
    expect(classificarConta(conta("331020002"))).toBe(GRUPO.DEDUCAO_NAO_TRIBUTARIA); // descontos
  });

  it("o ramo 5 inteiro é (-) IRPJ/CSLL", () => {
    for (const cc of ["5", "51", "511", "51101", "511010001", "511010002"]) {
      expect(classificarConta(conta(cc))).toBe(GRUPO.IMPOSTO_SOBRE_RESULTADO);
    }
  });

  it("receita financeira, outras receitas operacionais e despesa ficam de FORA", () => {
    expect(classificarConta(conta("312010002"))).toBe(GRUPO.FORA_DA_CONTA); // rendimento de aplicação
    expect(classificarConta(conta("321010001"))).toBe(GRUPO.FORA_DA_CONTA); // aluguéis
    expect(classificarConta(conta("411040001"))).toBe(GRUPO.FORA_DA_CONTA); // despesa
    expect(classificarConta(conta("111010001"))).toBe(GRUPO.FORA_DA_CONTA); // caixa
    expect(classificarConta(conta("211050005"))).toBe(GRUPO.FORA_DA_CONTA); // PIS A RECOLHER (passivo)
  });

  it("⚠⚠ conta SEM codigoCompleto é INDETERMINADO, nunca FORA — as duas respostas são diferentes", () => {
    expect(classificarConta({ codigo: "419", nome: "(-) PIS" })).toBe(GRUPO.INDETERMINADO);
    expect(classificarConta(conta(""))).toBe(GRUPO.INDETERMINADO);
    expect(classificarConta(conta(null))).toBe(GRUPO.INDETERMINADO);
    expect(classificarConta(null)).toBe(GRUPO.INDETERMINADO);
  });
});

describe("somarComponentes — o sinal segue a NATUREZA da conta, não o tipo da linha", () => {
  it("receita soma no crédito; imposto soma no débito", () => {
    const r = somarComponentes([
      { conta: RECEITA_SERVICOS, tipo: "C", valor: 100000 },
      { conta: MENOS_PIS, tipo: "D", valor: 650 },
      { conta: MENOS_COFINS, tipo: "D", valor: 3000 },
    ]);
    expect(r.receitaBruta).toBe(100000);
    expect(r.impostoSobreReceita).toBe(3650);
  });

  it("⚠ o ESTORNO subtrai — receita a débito e imposto a crédito", () => {
    const r = somarComponentes([
      { conta: RECEITA_SERVICOS, tipo: "C", valor: 100000 },
      { conta: RECEITA_SERVICOS, tipo: "D", valor: 10000 }, // estorno de receita
      { conta: MENOS_PIS, tipo: "D", valor: 650 },
      { conta: MENOS_PIS, tipo: "C", valor: 150 }, // estorno de provisão
    ]);
    expect(r.receitaBruta).toBe(90000);
    expect(r.impostoSobreReceita).toBe(500);
  });

  it("IRPJ e CSLL entram como imposto sobre o RESULTADO, separados dos que incidem na receita", () => {
    const r = somarComponentes([
      { conta: MENOS_PIS, tipo: "D", valor: 650 },
      { conta: MENOS_IRPJ, tipo: "D", valor: 2400 },
      { conta: MENOS_CSLL, tipo: "D", valor: 1440 },
    ]);
    expect(r.impostoSobreReceita).toBe(650);
    expect(r.impostoSobreResultado).toBe(3840);
  });

  it("a quebra por conta volta ordenada, com nome, para a tela poder mostrar de onde veio", () => {
    const r = somarComponentes([
      { conta: MENOS_PIS, tipo: "D", valor: 650 },
      { conta: MENOS_COFINS, tipo: "D", valor: 3000 },
      { conta: MENOS_ISS, tipo: "D", valor: 5000 },
    ]);
    expect(r.impostosPorConta.map((c) => c.codigo)).toEqual(["418", "420", "419"]);
    expect(r.impostosPorConta[0]).toMatchObject({ codigo: "418", nome: "(-) ISS", total: 5000 });
  });

  it("⚠⚠ a linha SEM conta não some — volta contada em naoClassificadas", () => {
    const r = somarComponentes([
      { conta: RECEITA_SERVICOS, tipo: "C", valor: 100000 },
      { conta: null, tipo: "D", valor: 1593 }, // a provisão que nasceu sem conta memorizada
      { conta: { codigo: "419" }, tipo: "D", valor: 650 }, // conta do plano sem codigoCompleto
    ]);
    expect(r.impostoSobreReceita).toBe(0);
    expect(r.naoClassificadas).toHaveLength(2);
    expect(r.naoClassificadas.map((n) => n.motivo).sort())
      .toEqual(["conta_fora_do_plano", "conta_sem_codigo_completo"]);
    expect(r.naoClassificadas.find((n) => n.motivo === "conta_fora_do_plano").valor).toBe(1593);
  });

  it("⚠ PARCELAMENTO não é a carga do mês — sai antes da classificação", () => {
    const r = somarComponentes([
      { conta: RECEITA_SERVICOS, tipo: "C", valor: 100000 },
      { conta: MENOS_PIS, tipo: "D", valor: 650 },
      { conta: MENOS_PIS, tipo: "D", valor: 90000, parcelamentoId: "parc-1" },
    ]);
    expect(r.impostoSobreReceita).toBe(650);
    // e não vira "não classificada" — ela foi excluída por MOTIVO, não por falta de conta.
    expect(r.naoClassificadas).toHaveLength(0);
  });

  it("valor ilegível conta como zero, não derruba a soma", () => {
    const r = somarComponentes([
      { conta: RECEITA_SERVICOS, tipo: "C", valor: 100000 },
      { conta: MENOS_PIS, tipo: "D", valor: "nao-e-numero" },
    ]);
    expect(r.receitaBruta).toBe(100000);
    expect(r.impostoSobreReceita).toBe(0);
  });

  it("entrada não-array não explode", () => {
    expect(somarComponentes(null).receitaBruta).toBe(0);
    expect(somarComponentes(undefined).naoClassificadas).toEqual([]);
  });
});

describe("aliquotaEfetivaDeLancamentos", () => {
  it("calcula sobre a receita bruta, somando os dois grupos de imposto", () => {
    const r = aliquotaEfetivaDeLancamentos([
      { conta: RECEITA_SERVICOS, tipo: "C", valor: 100000 },
      { conta: MENOS_PIS, tipo: "D", valor: 650 },
      { conta: MENOS_COFINS, tipo: "D", valor: 3000 },
      { conta: MENOS_IRPJ, tipo: "D", valor: 2400 },
      { conta: MENOS_CSLL, tipo: "D", valor: 1440 },
    ]);
    expect(r.situacao).toBe(SITUACAO.CALCULADA);
    expect(r.base).toBe(100000);
    expect(r.impostos).toBe(7490);
    expect(r.aliquota).toBeCloseTo(7.49, 10);
  });

  it("devoluções e descontos reduzem a BASE, não entram no numerador", () => {
    const r = aliquotaEfetivaDeLancamentos([
      { conta: RECEITA_SERVICOS, tipo: "C", valor: 100000 },
      { conta: conta("331010004", "410", "DEVOLUCOES EM PRESTACAO DE SERVICOS"), tipo: "D", valor: 20000 },
      { conta: MENOS_PIS, tipo: "D", valor: 650 },
    ]);
    expect(r.devolucoesEDescontos).toBe(20000);
    expect(r.base).toBe(80000);
    expect(r.impostos).toBe(650);
    expect(r.aliquota).toBeCloseTo(0.8125, 10);
  });

  it("⚠⚠ SEM RECEITA a alíquota é NULL, nunca 0 — e o caso é REAL", () => {
    // Medido em produção: KODA BEAR 2026-07 tem provisão de R$ 1.593,00 e NENHUMA receita
    // lançada em conta de receita. Uma alíquota "0%" ali afirmaria carga tributária zero.
    const r = aliquotaEfetivaDeLancamentos([{ conta: MENOS_PIS, tipo: "D", valor: 1593 }]);
    expect(r.aliquota).toBeNull();
    expect(r.situacao).toBe(SITUACAO.SEM_RECEITA_LANCADA);
    expect(r.impostos).toBe(1593);
  });

  it("⚠ SEM IMPOSTO a alíquota é NULL, e a situação é OUTRA — o conserto é diferente", () => {
    const r = aliquotaEfetivaDeLancamentos([{ conta: RECEITA_SERVICOS, tipo: "C", valor: 100000 }]);
    expect(r.aliquota).toBeNull();
    expect(r.situacao).toBe(SITUACAO.SEM_IMPOSTO_LANCADO);
    expect(r.base).toBe(100000);
  });

  it("sem lançamento nenhum a situação diz isso, e não 'sem receita'", () => {
    expect(aliquotaEfetivaDeLancamentos([]).situacao).toBe(SITUACAO.SEM_LANCAMENTO);
    expect(aliquotaEfetivaDeLancamentos([]).aliquota).toBeNull();
  });

  it("⚠ só linhas não classificadas ⇒ SEM_LANCAMENTO e a contagem visível", () => {
    const r = aliquotaEfetivaDeLancamentos([
      { conta: null, tipo: "D", valor: 1593 },
      { conta: null, tipo: "C", valor: 1593 },
    ]);
    expect(r.situacao).toBe(SITUACAO.SEM_LANCAMENTO);
    expect(r.naoClassificadas).toHaveLength(2);
  });

  it("o caso REAL da SINTROPIA 2026-06 — receita e impostos ambos lançados", () => {
    // Medido: receita em conta de receita R$ 617.577,94 é o LÍQUIDO já com as deduções.
    // Aqui a receita bruta e os impostos entram separados, como a regra os lê.
    const r = aliquotaEfetivaDeLancamentos([
      { conta: RECEITA_SERVICOS, tipo: "C", valor: 654577.30 },
      { conta: MENOS_ISS, tipo: "D", valor: 29019.04 },
      { conta: MENOS_PIS, tipo: "D", valor: 4253.75 },
      { conta: MENOS_COFINS, tipo: "D", valor: 19626.57 },
    ]);
    expect(r.situacao).toBe(SITUACAO.CALCULADA);
    expect(r.base).toBeCloseTo(654577.30, 2);
    expect(r.impostos).toBeCloseTo(52899.36, 2);
    expect(r.aliquota).toBeCloseTo(8.0814, 3);
  });
});
