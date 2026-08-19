// A REGRA DO CAMPO DE VALOR — nenhuma tela aqui.
//
// ⚠⚠ O QUE ESTE ARQUIVO TRANCA É UM ERRO DE ORDEM DE GRANDEZA. A leitura anterior era
// `Number(String(v).replace(",", "."))` e dava três desfechos para três grafias plausíveis:
// "1.500" → 1,5 · "1.500,00" → NaN · "1500.00" → 1500. O do meio emite a nota por 1/1000 do valor,
// e nota emitida não se desfaz.
//
// ⚠ Os casos de COLAGEM não são exaustividade decorativa: são a lista fechada de grafias que uma
// planilha produz. Cada `RECUSA` aqui é uma conversão que decidimos NÃO fazer.

import {
  RECUSA_COLAGEM,
  formatarValorParaCampo,
  lerValorColado,
  lerValorDoCampo,
  mascararValorDigitado,
  textoDaRecusaDeColagem,
} from "../valorDaNota";

describe("digitação — o campo só consegue conter a forma canônica", () => {
  it("o teclado é um fluxo de dígitos em centavos", () => {
    expect(mascararValorDigitado("5")).toBe("0,05");
    expect(mascararValorDigitado("50")).toBe("0,50");
    expect(mascararValorDigitado("1500")).toBe("15,00");
    expect(mascararValorDigitado("150000")).toBe("1.500,00");
    expect(mascararValorDigitado("123456789")).toBe("1.234.567,89");
  });

  // ⚠ A INVARIANTE QUE MATA A AMBIGUIDADE: qualquer coisa que se tente escrever com ponto, vírgula
  // ou "R$" desaba nos mesmos dígitos. Não existe duas grafias no campo, logo não existe o que
  // decidir depois.
  it("ponto, vírgula e símbolo de moeda não entram — não há grafia ambígua a escrever", () => {
    expect(mascararValorDigitado("1500.00")).toBe("1.500,00");
    expect(mascararValorDigitado("1.500,00")).toBe("1.500,00");
    expect(mascararValorDigitado("R$ 1500,00")).toBe("1.500,00");
    expect(mascararValorDigitado("abc")).toBe("");
  });

  // ⚠ ZERO DIGITADO ≠ CAMPO VAZIO. É a mesma disciplina do `pTotTrib*` do cadastro e da folha
  // ausente no planejamento: a máscara não pode fabricar um "0,00" onde ninguém escreveu nada.
  it("campo em branco continua em branco; zero escrito continua zero", () => {
    expect(mascararValorDigitado("")).toBe("");
    expect(lerValorDoCampo("")).toBeNull();
    expect(mascararValorDigitado("0")).toBe("0,00");
    expect(lerValorDoCampo("0,00")).toBe(0);
  });

  // ⚠ A conta passa por INTEIRO de centavos, nunca por `Number("1500.00")`. Num documento fiscal o
  // arredondamento de float não é detalhe.
  it("a leitura de volta é exata", () => {
    expect(lerValorDoCampo("1.500,00")).toBe(1500);
    expect(lerValorDoCampo("0,07")).toBe(0.07);
    expect(lerValorDoCampo("1.234.567,89")).toBe(1234567.89);
    expect(lerValorDoCampo("12,30")).toBe(12.3);
  });
});

describe("número → campo (nota reaproveitada abrindo o assistente)", () => {
  it("sai na forma canônica, com milhar", () => {
    expect(formatarValorParaCampo(1500)).toBe("1.500,00");
    expect(formatarValorParaCampo(1234567.89)).toBe("1.234.567,89");
    expect(formatarValorParaCampo(0.5)).toBe("0,50");
  });

  // ⚠ Valor ausente abre o campo VAZIO. "0,00" ali afirmaria que a nota modelo vale zero.
  it("ausência e zero abrem o campo vazio", () => {
    expect(formatarValorParaCampo(null)).toBe("");
    expect(formatarValorParaCampo(0)).toBe("");
    expect(formatarValorParaCampo("abc")).toBe("");
  });

  // Ida e volta: o que o pré-preenchimento escreve, o campo lê igual.
  it("ida e volta não muda o número", () => {
    for (const n of [0.01, 1, 99.99, 1500, 1234567.89]) {
      expect(lerValorDoCampo(formatarValorParaCampo(n))).toBe(n);
    }
  });
});

describe("colagem — as grafias que uma planilha produz", () => {
  const aceita = (texto, valor) => {
    const r = lerValorColado(texto);
    expect(r.ok).toBe(true);
    expect(r.valor).toBe(valor);
  };

  // ⚠ "1500" colado NÃO é 15,00 — é a diferença entre a colagem e a digitação, e é por isso que a
  // colagem tem gramática própria em vez de passar pela máscara.
  it("inteiro sem separador nenhum é reais, não centavos", () => {
    aceita("1500", 1500);
    aceita("0", 0);
  });

  it("pt-BR completo e pt-BR sem milhar", () => {
    aceita("1.500,00", 1500);
    aceita("1500,00", 1500);
    aceita("1.234.567,89", 1234567.89);
    aceita("1500,5", 1500.5);
  });

  it("en-US completo", () => {
    aceita("1,500.00", 1500);
    aceita("1,234,567.89", 1234567.89);
  });

  // ⚠ Ponto com 1 ou 2 casas NÃO pode ser milhar pt-BR (milhar agrupa de 3 em 3). É a forma que sai
  // de uma planilha configurada em inglês, e é a mais colada de todas.
  it("ponto com 1 ou 2 casas é decimal, sem dúvida", () => {
    aceita("1500.00", 1500);
    aceita("1500.5", 1500.5);
    aceita("1.5", 1.5);
  });

  it("R$ e espaços saem sem mudar a leitura", () => {
    aceita("R$ 1.500,00", 1500);
    aceita(" 1500,00 ", 1500);
    aceita("R$ 1.500,00", 1500);
  });

  // ⚠⚠ AS DUAS QUE O DONO NOMEOU. Elas têm duas leituras legítimas, e converter em silêncio é
  // exatamente o erro de ordem de grandeza. O campo fica INTOCADO e a tela diz o porquê.
  it("1.500 e 1,500 são RECUSADOS — duas leituras, nenhuma escolha nossa", () => {
    for (const t of ["1.500", "1,500", "12.345", "1.500.000", "12,345"]) {
      const r = lerValorColado(t);
      expect(r.ok).toBe(false);
      expect(r.motivo).toBe(RECUSA_COLAGEM.AMBIGUO);
    }
  });

  it("o que não é valor em reais é recusado, sem tentativa de conserto", () => {
    for (const t of ["", "abc", "-100", "1,5000", "1.2.3", "1500,000", "R$"]) {
      expect(lerValorColado(t).ok).toBe(false);
    }
  });

  // ⚠ A recusa PRECISA virar frase: sem ela o Ctrl+V "não faz nada", que é o defeito de erro
  // engolido que este projeto já catalogou.
  it("toda recusa tem texto para a tela, e a ambígua diz qual é a dúvida", () => {
    const ambigua = textoDaRecusaDeColagem(lerValorColado("1.500"));
    expect(ambigua).toMatch(/duas leituras/i);
    expect(ambigua).toMatch(/1\.500/);
    expect(textoDaRecusaDeColagem(lerValorColado("abc"))).toMatch(/sem adivinhar/i);
    expect(textoDaRecusaDeColagem(lerValorColado("1500"))).toBeNull(); // aceita não tem recusa
  });

  // ⚠ O que a colagem devolve tem de caber no campo E ser lido igual por ele — senão a tela mostra
  // um número e o payload manda outro.
  it("o mascarado devolvido é lido pelo campo com o MESMO número", () => {
    for (const t of ["1500", "1.500,00", "1,500.00", "1500.00", "R$ 1.234.567,89"]) {
      const r = lerValorColado(t);
      expect(lerValorDoCampo(r.mascarado)).toBe(r.valor);
    }
  });
});
