// O DÍGITO VERIFICADOR DO CPF — aritmética, e nada além dela.
//
// ⚠ Nenhum destes números pertence a ninguém: são bases fabricadas com o DV calculado pela própria
// regra (mesma disciplina das fixtures anonimizadas do SITFIS). E ⚠ **nada aqui consulta nada** —
// não há rede, não há banco, não há BrasilAPI. Ver o cabeçalho de `utils/cpf.js` para o porquê.

import { cpfTemDvValido } from "../cpf.js";

describe("CPF com DV correto passa", () => {
  it.each(["11144477735", "52998224725", "12345678909", "98765432100", "00000000191"])(
    "%s",
    (cpf) => {
      expect(cpfTemDvValido(cpf)).toBe(true);
    }
  );

  it("a pontuação não muda a resposta", () => {
    expect(cpfTemDvValido("111.444.777-35")).toBe(true);
    expect(cpfTemDvValido(" 111 444 777 35 ")).toBe(true);
  });

  it("⚠ o caso do resto < 2 (DV = 0) é exercido — é onde a fórmula ingênua erra", () => {
    // `98765432100` termina em dois zeros justamente por esse ramo.
    expect(cpfTemDvValido("98765432100")).toBe(true);
  });
});

describe("CPF com DV errado NÃO passa", () => {
  it("um dígito trocado no verificador derruba", () => {
    expect(cpfTemDvValido("11144477734")).toBe(false);
    expect(cpfTemDvValido("11144477725")).toBe(false);
  });

  it("⚠ dígito trocado no MEIO derruba — é o erro de digitação que isto existe para pegar", () => {
    // 111444777-35 com o 4 do meio virando 5: o DV deixa de fechar.
    expect(cpfTemDvValido("11154477735")).toBe(false);
  });

  it("dois dígitos transpostos derrubam", () => {
    expect(cpfTemDvValido("11141477735")).toBe(false);
  });
});

describe("⚠ sequências repetidas passam no módulo 11 e são recusadas à parte", () => {
  it.each([
    "00000000000",
    "11111111111",
    "22222222222",
    "33333333333",
    "44444444444",
    "55555555555",
    "66666666666",
    "77777777777",
    "88888888888",
    "99999999999",
  ])("%s", (cpf) => {
    expect(cpfTemDvValido(cpf)).toBe(false);
  });
});

describe("o que não é CPF", () => {
  it("comprimento diferente de 11 é falso — inclusive CNPJ", () => {
    expect(cpfTemDvValido("11222333000181")).toBe(false);
    expect(cpfTemDvValido("1114447773")).toBe(false);
    expect(cpfTemDvValido("111444777351")).toBe(false);
  });

  it("ausente, nulo e vazio são falsos (nunca lançam)", () => {
    expect(cpfTemDvValido(undefined)).toBe(false);
    expect(cpfTemDvValido(null)).toBe(false);
    expect(cpfTemDvValido("")).toBe(false);
    expect(cpfTemDvValido("abcdefghijk")).toBe(false);
  });

  it("aceita número, não só string (o payload pode chegar sem aspas)", () => {
    expect(cpfTemDvValido(11144477735)).toBe(true);
  });
});
