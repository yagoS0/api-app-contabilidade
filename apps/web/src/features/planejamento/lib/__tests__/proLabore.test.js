// QUANTO CUSTA SUBIR O PRÓ-LABORE ATÉ O FATOR R — e as quatro recusas.
//
// O dono nomeou esta conta como a mais valiosa do produto: "quanto de pró-labore preciso para
// chegar a 28%, quanto isso custa em INSS/IRPF do sócio, e quanto economiza no DAS (…) exatamente o
// cálculo que o contador não consegue fazer de cabeça".
//
// ⚠ OS NÚMEROS SÃO CONFERIDOS CONTRA A LEI, não contra o próprio motor: o IRRF é recalculado à mão
// dentro do teste, e o INSS idem.

import {
  irrfMensal, inssDoProLabore, custoMensalDoSocio, simularProLaboreParaFatorR, RECUSA,
} from "../proLabore";
import {
  IRPF_MENSAL, DESCONTO_SIMPLIFICADO_MENSAL, IRPF_REDUTOR_MENSAL, INSS_SALARIO_CONTRIBUICAO,
} from "../tabelasPessoaFisica.data";

describe("⚠ INSS do pró-labore — 11%, e o TETO é o que faz a conta virar", () => {
  it("abaixo do teto, é 11% cheios", () => {
    expect(inssDoProLabore(5_000)).toBeCloseTo(550, 6);
  });

  it("⚠⚠ ACIMA DO TETO ele PARA de crescer — cada real a mais custa só IRPF", () => {
    // Ignorar o teto superestimaria o custo em toda simulação relevante.
    const noTeto = inssDoProLabore(INSS_SALARIO_CONTRIBUICAO.teto);
    expect(inssDoProLabore(INSS_SALARIO_CONTRIBUICAO.teto + 10_000)).toBeCloseTo(noTeto, 6);
    expect(noTeto).toBeCloseTo(INSS_SALARIO_CONTRIBUICAO.teto * 0.11, 6);
  });

  it.each([0, -5, null, undefined, "x"])("%p não vira contribuição", (v) => expect(inssDoProLabore(v)).toBe(0));
});

describe("⚠⚠ O REDUTOR DA LEI 15.270/2025 — sem ele, R$ 5.000 pagaria imposto onde a lei manda ZERO", () => {
  it("até R$ 5.000 o imposto é ZERO", () => {
    for (const v of [1_000, 3_000, 4_999.99, 5_000]) expect(irrfMensal(v)).toBe(0);
  });

  it("⚠ logo acima de R$ 5.000 ele NÃO salta — a redução é contínua", () => {
    // Um degrau aqui seria o sinal de que a fórmula do redutor foi transcrita errada.
    const a = irrfMensal(5_000);
    const b = irrfMensal(5_050);
    expect(b).toBeGreaterThanOrEqual(a);
    expect(b - a).toBeLessThan(30);
  });

  it("⚠ a partir de R$ 7.350 a redução acaba e vale a tabela cheia", () => {
    const bruto = 9_000;
    const base = bruto - DESCONTO_SIMPLIFICADO_MENSAL;
    const faixa = IRPF_MENSAL.find((f) => f.ate == null || base <= f.ate);
    // ⚠ Conferido contra a LEI: base × alíquota − dedução, sem redutor.
    expect(irrfMensal(bruto)).toBeCloseTo(base * faixa.aliquota - faixa.deduzir, 6);
  });

  it("o imposto cresce com o rendimento, sempre", () => {
    let anterior = -1;
    for (const v of [4_000, 5_500, 6_500, 7_400, 10_000, 20_000]) {
      const i = irrfMensal(v);
      expect(i).toBeGreaterThanOrEqual(anterior);
      anterior = i;
    }
  });

  it("⚠ a fórmula do redutor fecha nos dois extremos — é a prova do gate, refeita aqui", () => {
    const r = IRPF_REDUTOR_MENSAL;
    expect(r.constante - r.fator * r.isentoAte).toBeCloseTo(r.reducaoMaxima, 2);
    expect(r.constante - r.fator * r.parcialAte).toBeCloseTo(0, 2);
  });
});

describe("⚠ o INSS retido REDUZ a base do IRRF", () => {
  it("o custo usa a base já líquida de INSS — esquecer isso superestima o imposto", () => {
    const v = 12_000;
    const c = custoMensalDoSocio(v);
    expect(c.inss).toBeCloseTo(inssDoProLabore(v), 6);
    expect(c.irrf).toBeCloseTo(irrfMensal(v - c.inss), 6);
    expect(c.liquido).toBeCloseTo(v - c.inss - c.irrf, 6);
  });
});

describe("⚠⚠ AS QUATRO RECUSAS", () => {
  it("sem RBT12 não há Fator R a alcançar", () => {
    expect(simularProLaboreParaFatorR({ rbt12: 0, folha12mAtual: 10_000 }).recusa).toBe(RECUSA.SEM_RBT12);
  });

  it("⚠⚠ FOLHA AUSENTE NÃO É ZERO — a recusa diz por quê", () => {
    // Tratá-la como zero diria ao contador que ele precisa criar a folha inteira do nada.
    const r = simularProLaboreParaFatorR({ rbt12: 700_000, folha12mAtual: null });
    expect(r.recusa).toBe(RECUSA.SEM_FOLHA);
    expect(r.motivo).toMatch(/criar a folha inteira/i);
  });

  it("⚠⚠ NO ANEXO IV A SIMULAÇÃO NÃO VALE, e ela RECUSA em vez de calcular errado", () => {
    // Lá a CPP fica FORA do DAS (art. 18, § 5º-C): cada real de pró-labore custa 20% à empresa por
    // cima, e a premissa que sustenta a conta inteira deixa de valer.
    const r = simularProLaboreParaFatorR({ rbt12: 700_000, folha12mAtual: 30_000, anexoDestino: "IV" });
    expect(r.recusa).toBe(RECUSA.ANEXO_IV);
    expect(r.motivo).toMatch(/FORA do DAS/i);
  });

  it("quem já atinge os 28% recebe a MARGEM, não um aumento", () => {
    const r = simularProLaboreParaFatorR({ rbt12: 700_000, folha12mAtual: 300_000 });
    expect(r.recusa).toBe(RECUSA.JA_ATINGE);
    expect(r.margemAnual).toBeGreaterThan(0);
    expect(r.motivo).toMatch(/margem até cair para o Anexo V/i);
  });
});

describe("⚠⚠ O CUSTO É O INCREMENTAL — não o do pró-labore inteiro", () => {
  // O sócio JÁ paga INSS e IRRF sobre o pró-labore de hoje. Comparar o custo total com a economia
  // do DAS somaria imposto que já era pago de qualquer jeito, e a decisão pareceria sempre ruim.
  const caso = { rbt12: 718_036.09, folha12mAtual: 31_500, economiaNoDas: 47_000 };

  it("a folha necessária é 28% do RBT12", () => {
    const r = simularProLaboreParaFatorR(caso);
    expect(r.folhaNecessaria).toBeCloseTo(718_036.09 * 0.28, 6);
    expect(r.faltaNoAno).toBeCloseTo(718_036.09 * 0.28 - 31_500, 6);
  });

  it("⚠ o custo é a DIFERENÇA entre o depois e o hoje", () => {
    const r = simularProLaboreParaFatorR(caso);
    const esperado = (r.depois.inss + r.depois.irrf) - (r.hoje.inss + r.hoje.irrf);
    expect(r.custoMensalIncremental).toBeCloseTo(esperado, 6);
    expect(r.custoAnualIncremental).toBeCloseTo(esperado * 12, 6);
  });

  it("⚠ e ele é MENOR que o custo do pró-labore inteiro", () => {
    const r = simularProLaboreParaFatorR(caso);
    const inteiro = (r.depois.inss + r.depois.irrf) * 12;
    expect(r.custoAnualIncremental).toBeLessThan(inteiro);
  });

  it("com a economia informada, o saldo e o veredito aparecem", () => {
    const r = simularProLaboreParaFatorR(caso);
    expect(r.saldoAnual).toBeCloseTo(47_000 - r.custoAnualIncremental, 6);
    expect(r.compensa).toBe(r.saldoAnual > 0);
  });

  it("⚠⚠ SEM a economia, o saldo é NULL — nunca o custo negativado", () => {
    // Um saldo igual a `-custo` faria a decisão parecer sempre ruim por falta de metade da conta.
    const r = simularProLaboreParaFatorR({ ...caso, economiaNoDas: null });
    expect(r.saldoAnual).toBeNull();
    expect(r.compensa).toBeNull();
    expect(r.custoAnualIncremental).toBeGreaterThan(0);
  });
});

describe("⚠ A PREMISSA QUE DECIDE O RESULTADO VAI IMPRESSA", () => {
  it("a CPP dentro do DAS é dita, com a lei", () => {
    // Se ela não valer, a conta inteira muda de sinal. Não pode ser rodapé.
    const r = simularProLaboreParaFatorR({ rbt12: 718_036.09, folha12mAtual: 31_500 });
    expect(r.premissas.join(" | ")).toMatch(/DENTRO do DAS/);
    expect(r.premissas.join(" | ")).toMatch(/art\. 13, VI/);
    expect(r.premissas.join(" | ")).toMatch(/NÃO custa 20% de CPP/);
  });

  it("⚠ a VIGÊNCIA das tabelas vai junto — tabela de pessoa física sem data envelhece calada", () => {
    const r = simularProLaboreParaFatorR({ rbt12: 718_036.09, folha12mAtual: 31_500 });
    expect(r.premissas.join(" | ")).toMatch(/vig[êe]ncia 2026/i);
  });

  it("⚠ e o que ficou de fora é nomeado — RAT/FAP, 13º, efeito previdenciário", () => {
    const r = simularProLaboreParaFatorR({ rbt12: 718_036.09, folha12mAtual: 31_500 });
    const texto = r.naoConsiderado.join(" | ");
    expect(texto).toMatch(/RAT\/FAP/);
    expect(texto).toMatch(/13º/);
    expect(texto).toMatch(/previdenciário/i);
  });
});
