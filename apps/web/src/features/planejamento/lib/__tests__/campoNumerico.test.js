// AS DUAS METADES DO CAMPO NUMÉRICO — o contrato é a IDA E VOLTA, não cada metade sozinha.
//
// ⚠⚠ ESTE ARQUIVO EXISTE POR CAUSA DE UM DEFEITO DE PRODUÇÃO (25/08/2026). O motor fiscal tinha 95
// testes, 24 deles casos dourados calculados à mão, e estava CERTO. Quebrado estava o pedaço que
// ninguém media: o número saindo do banco, virando texto de input, e voltando a número.
//
// Medido antes do conserto (`apps/api/scripts/diag-planejamento-prefill.mjs`, contra produção):
// 12 de 18 empresas com dado apurado liam o valor inflado ×100 — 3 com o card do Lucro Presumido
// morto ("não é elegível") e 7 com o do Simples ("Sem RBT12"), sobre números que estavam na tela.

import { paraCampo, deCampo } from "../campoNumerico";

describe("⚠⚠ A IDA E VOLTA — o campo NUNCA mostra um número diferente do que o motor lê", () => {
  // Os quatro primeiros são valores REAIS de produção, com os nomes das empresas fora daqui.
  it.each([
    888_286.09, // LENTE — receita anual
    718_036.09, // LENTE — RBT12
    3_296_346.74, // SINTROPIA — receita anual
    980_693.64, // SANTA ALEGRE — receita anual
    31_500, // folha sem centavos: o caso que SEMPRE funcionou, e por isso escondeu o resto
    0,
    0.01,
    5,
    3.5, // ISS fracionário — virava 35%
    1_234.5,
    78_000_000.01,
  ])("%p sobrevive a paraCampo → deCampo", (n) => {
    expect(deCampo(paraCampo(n))).toBe(n);
  });

  it("⚠⚠ o defeito ORIGINAL, travado: `String(n)` NÃO sobrevive — e é isso que a página fazia", () => {
    // Se algum dia alguém "simplificar" `paraCampo` de volta para `String`, este teste cai.
    expect(deCampo(String(888_286.09))).toBe(88_828_609);
    expect(deCampo(paraCampo(888_286.09))).toBe(888_286.09);
  });

  it("formata em pt-BR, com o ponto de milhar que faz a volta funcionar", () => {
    expect(paraCampo(888_286.09)).toBe("888.286,09");
    expect(paraCampo(31_500)).toBe("31.500");
    expect(paraCampo(3.5)).toBe("3,5");
  });
});

describe("⚠ AUSÊNCIA NÃO É ZERO — dos dois lados", () => {
  it.each([null, undefined, ""])("paraCampo(%p) devolve string vazia, nunca \"0\"", (v) => {
    expect(paraCampo(v)).toBe("");
  });

  it.each([null, undefined, ""])("deCampo(%p) devolve null, nunca 0", (v) => {
    expect(deCampo(v)).toBeNull();
  });

  it("⚠ zero DIGITADO continua sendo zero — a distinção é `null` × `0`", () => {
    // Mesma disciplina de `folhaAusenteNaoEZero.test.js`: folha ausente não se calcula; folha
    // informada como zero, sim.
    expect(deCampo("0")).toBe(0);
    expect(paraCampo(0)).toBe("0");
  });

  it("texto ilegível não vira número", () => {
    expect(deCampo("abc")).toBeNull();
    expect(paraCampo(Number.NaN)).toBe("");
    expect(paraCampo(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("⚠⚠ deCampo CONTINUA LENDO EM pt-BR — o conserto não afrouxou a digitação", () => {
  // "1.234" é genuinamente ambíguo, e quem digita numa tela brasileira quer mil duzentos e trinta e
  // quatro. Afrouxar isto para "consertar" o prefill teria trocado um defeito por outro, no lado de
  // quem DIGITA — que é o uso normal da tela.
  it("ponto é separador de milhar", () => {
    expect(deCampo("1.250.000")).toBe(1_250_000);
    expect(deCampo("1.234")).toBe(1234);
  });

  it("vírgula é o decimal", () => {
    expect(deCampo("888.286,09")).toBe(888_286.09);
    expect(deCampo("3,5")).toBe(3.5);
  });
});
