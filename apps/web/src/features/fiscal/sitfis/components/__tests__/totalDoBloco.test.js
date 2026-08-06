// O TOTAL DAS PENDÊNCIAS DO SITFIS.
//
// A tabela tem cinco colunas de dinheiro com valores parecidos, e num Lucro Presumido com IRPJ,
// CSLL, PIS e COFINS a pergunta óbvia — "quanto esta empresa deve?" — exigia somar quatro linhas de
// cabeça. O total responde isso.
//
// ⚠ O QUE ESTES TESTES PROTEGEM DE VERDADE é o caso em que ele NÃO deve aparecer. Os valores são
// strings lidas de um PDF; um total parcial mostraria uma dívida MENOR que a real, e o contador
// leria o número achando que está conferido. É a mesma disciplina da autoverificação do comprovante
// de arrecadação — só mostra quando fecha.

import { parseValorBR, totalDoBloco } from "../SitfisRelatorioTabela";

const COL = ["Receita", "Sdo. Dev. Cons."];
const reg = (...valores) => valores.map((v) => ({ "Receita": "x", "Sdo. Dev. Cons.": v }));

describe("parseValorBR", () => {
  it("lê o formato brasileiro com milhar", () => {
    expect(parseValorBR("15.510,72")).toBe(15510.72);
    expect(parseValorBR("52,14")).toBe(52.14);
  });

  it("⚠ o que não for número reconhecível vira null, NUNCA zero", () => {
    // Zero somaria silenciosamente como "essa linha não deve nada", que é uma afirmação falsa.
    expect(parseValorBR("")).toBeNull();
    expect(parseValorBR(null)).toBeNull();
    expect(parseValorBR("—")).toBeNull();
    expect(parseValorBR("EM COBRANÇA")).toBeNull();
    expect(parseValorBR("1.234")).toBeNull();   // sem centavos: não é o formato da coluna
    expect(parseValorBR("12,3")).toBeNull();    // um decimal só
  });
});

describe("totalDoBloco", () => {
  it("soma o saldo consolidado de todas as linhas", () => {
    // Os quatro tributos do Presumido, como aparecem no relatório real.
    const t = totalDoBloco(COL, reg("15.510,72", "9.306,43", "1.681,44", "7.755,36"));
    expect(t).toBe(34253.95);
  });

  it("⚠ UMA linha ilegível invalida o total INTEIRO", () => {
    // O caso caro: somar as três legíveis mostraria R$ 26.498,59 de dívida onde há mais, e o
    // número pareceria conferido.
    expect(totalDoBloco(COL, reg("15.510,72", "9.306,43", "EM COBRANÇA", "1.681,44"))).toBeNull();
  });

  it("com UMA linha não há total — seria o próprio valor repetido embaixo", () => {
    expect(totalDoBloco(COL, reg("15.510,72"))).toBeNull();
  });

  it("bloco sem a coluna de saldo não soma nada", () => {
    // Ex.: "Pendência - Processo Fiscal", que tem Processo/Situação/Localização.
    expect(totalDoBloco(["Processo", "Situação"], [{ Processo: "a" }, { Processo: "b" }])).toBeNull();
  });

  it("centavos não acumulam erro de float", () => {
    // 0,1 + 0,2 em ponto flutuante dá 0.30000000000000004 — na tela isso viraria um centavo errado.
    expect(totalDoBloco(COL, reg("0,10", "0,20"))).toBe(0.3);
  });

  it("entrada vazia ou ausente não quebra", () => {
    expect(totalDoBloco(COL, [])).toBeNull();
    expect(totalDoBloco(null, null)).toBeNull();
  });
});
