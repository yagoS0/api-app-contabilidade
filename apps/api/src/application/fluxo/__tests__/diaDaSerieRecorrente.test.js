// ⚠⚠ A RECORRÊNCIA GANHA UM DIA — e ele é ESTIMATIVA, nunca vencimento (31/08/2026)
//
// > Dono: *"o fluxo de caixa mostra uma saída de 3.200, mas não coloca em nenhum dia e não temos
// > como saber o que é"* → *"eu quero que entre em algum dia, pode ser no dia em que a nota foi
// > emitida, não tem problema, pode ser modificado posteriormente."*
//
// ⚠⚠ **NÃO EXISTE "O DIA" DA SÉRIE, e a série real é a prova.** A SPO TECNOLOGIA, da SINCROSAT, foi
// emitida em **20/03, 02/04 e 04/05**: o valor não varia nada (3.200 nas três) e o dia varia 18
// dias. Esses três números viram teste aqui — são eles que separam "mediana" de qualquer outra
// escolha que pareceria igual olhando só o resultado.

import { diaTipico, lerSerie } from "../lib/recorrencia.js";
import { diaDoMesValido, encaixarNoMes } from "../lib/fluxoDeCaixa.js";

// Os dias reais das três notas da SPO TECNOLOGIA (medidos em produção, 31/08/2026).
const SPO = [
  { competencia: "2026-03", valor: 3200, dia: 20 },
  { competencia: "2026-04", valor: 3200, dia: 2 },
  { competencia: "2026-05", valor: 3200, dia: 4 },
];

describe("⚠⚠ o dia típico — a série REAL da SINCROSAT", () => {
  it("a SPO TECNOLOGIA cai no dia 4 — a mediana de 20, 2 e 4", () => {
    expect(diaTipico(SPO)).toEqual({ dia: 4, dias: [20, 2, 4] });
  });

  it("⚠⚠ os dias observados VIAJAM — sem eles, 'por que dia 4?' não tem resposta", () => {
    // É o mesmo argumento de `valores`: o resumo sozinho não deixa ninguém refazer a conta.
    expect(diaTipico(SPO).dias).toEqual([20, 2, 4]);
  });

  it("⚠ mediana quebrada arredonda para BAIXO — numa SAÍDA, o dia mais cedo é o conservador", () => {
    // A queda de saldo aparece antes do que talvez aconteça, nunca depois.
    expect(diaTipico([{ dia: 4 }, { dia: 5 }]).dia).toBe(4);
    expect(diaTipico([{ dia: 10 }, { dia: 21 }]).dia).toBe(15);
  });

  it("⚠⚠ observação SEM dia é ignorada, nunca vira dia zero", () => {
    // `Number(null) === 0` e 0 é finito: o guard é por `Number.isInteger` mais faixa.
    expect(diaTipico([{ dia: null }, { dia: 10 }, { dia: undefined }])).toEqual({ dia: 10, dias: [10] });
    expect(diaTipico([{ dia: 0 }, { dia: 32 }, { dia: 4.7 }, { dia: "10" }])).toEqual({ dia: 10, dias: [10] });
  });

  it("nenhuma observação com dia devolve `null` — e null é 'não sei', não 'dia 1'", () => {
    expect(diaTipico([]).dia).toBeNull();
    expect(diaTipico(null).dia).toBeNull();
    expect(diaTipico([{ dia: null }]).dia).toBeNull();
  });

  it("⚠ o dia entra em `baseDaObservacao`, junto com a evidência do valor", () => {
    const { base } = lerSerie({ observacoes: SPO, cicloAtual: "2026-06" });
    expect(base.dia).toBe(4);
    expect(base.dias).toEqual([20, 2, 4]);
    // ⚠ E não atropela nada do que já viajava: a faixa continua inteira.
    expect(base.mediana).toBe(3200);
    expect(base.n).toBe(3);
  });
});

describe("⚠⚠ o encaixe no mês — o dia 31 que sumiria cinco vezes por ano", () => {
  it("dia 31 em fevereiro vira 28, e em ano bissexto vira 29", () => {
    expect(encaixarNoMes("2026-02", 31)).toBe(28);
    expect(encaixarNoMes("2028-02", 31)).toBe(29); // 2028 é bissexto
  });

  it("⚠⚠ e nos meses de 30 dias ele vira 30 — sem isto a linha SUMIRIA de abril, junho, setembro e novembro", () => {
    for (const mes of ["04", "06", "09", "11"]) expect(encaixarNoMes(`2026-${mes}`, 31)).toBe(30);
  });

  it("dia que cabe passa intocado", () => {
    expect(encaixarNoMes("2026-02", 4)).toBe(4);
    expect(encaixarNoMes("2026-01", 31)).toBe(31);
  });

  it("⚠ competência ilegível devolve `null` — nunca um dia chutado", () => {
    for (const c of [null, "", "2026", "26-01", "2026-13-01", {}]) {
      expect(encaixarNoMes(c, 10)).toBeNull();
    }
  });

  it("⚠ o guard do dia é por TIPO — 0, 32, fração e nulo não são dia", () => {
    for (const v of [0, 32, -1, 4.7, null, undefined, "", "abc", {}, NaN]) {
      expect(diaDoMesValido(v)).toBeNull();
    }
    // ⚠ String numérica passa: é o que chega do corpo de um PATCH.
    expect(diaDoMesValido("10")).toBe(10);
    expect(diaDoMesValido(1)).toBe(1);
    expect(diaDoMesValido(31)).toBe(31);
  });
});
