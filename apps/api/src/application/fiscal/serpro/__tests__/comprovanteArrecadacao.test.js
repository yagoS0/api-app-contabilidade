// A ORDEM DAS COLUNAS DO COMPROVANTE — fixada por evidência, e sem teste até aqui.
//
// ⚠ Por que isto precisa de teste próprio: a autoverificação do parser (`principal+juros+multa`
// bate com o total) **não detecta juros trocado com multa** — a soma é idêntica dos dois jeitos.
// Ou seja, o único guarda-costas do parser é cego exatamente para o erro mais provável. E o erro
// não é acadêmico: juros e multa viram lançamentos separados, em contas diferentes (501 e 506).
//
// A ordem real no texto extraído é `principal · MULTA · JUROS · total` — o INVERSO do cabeçalho
// impresso ("Total Juros Multa Principal"). Confirmada por aritmética num comprovante de INSS real:
//   12,94 / 178,31 = 7,26% = 0,33%/dia × 22 dias  → multa de mora
//    1,78 / 178,31 = 1,00%                        → juros do mês do pagamento
// Os dois caem em valores canônicos da legislação. Se alguém "consertar" a ordem achando que segue
// o cabeçalho, este teste quebra.

import { parseComprovanteArrecadacao } from "../parseComprovanteArrecadacao.js";

// Comprovante de INSS com acréscimo, no layout observado (uma célula por linha).
const COMPROVANTE_COM_ACRESCIMO = `
Comprovante de Arrecadacao
Data de Arrecadação
04/08/2026
Documento pago via INTERNET
Totais
178,31 12,94 1,78 193,03
`;

const COMPROVANTE_SEM_TOTAIS = `
Comprovante de Arrecadacao
Data de Arrecadação
04/08/2026
1082 CP-SEGURADO 178,31 12,94 1,78 193,03
`;

// Soma que não fecha: 100 + 10 + 5 = 115, mas o total diz 200.
const COMPROVANTE_INCOERENTE = `
Totais
100,00 10,00 5,00 200,00
`;

describe("parseComprovanteArrecadacao", () => {
  it("a 2ª coluna é MULTA e a 3ª é JUROS — não o contrário", () => {
    const r = parseComprovanteArrecadacao(COMPROVANTE_COM_ACRESCIMO);
    expect(r.principal).toBeCloseTo(178.31, 2);
    expect(r.multa).toBeCloseTo(12.94, 2);   // 7,26% = 0,33%/dia × 22 dias
    expect(r.juros).toBeCloseTo(1.78, 2);    // 1,00% no mês do pagamento
    expect(r.total).toBeCloseTo(193.03, 2);
    expect(r.confiavel).toBe(true);
  });

  it("a soma dos componentes fecha com o total", () => {
    const r = parseComprovanteArrecadacao(COMPROVANTE_COM_ACRESCIMO);
    expect(r.principal + r.juros + r.multa).toBeCloseTo(r.total, 2);
  });

  it("lê a data de arrecadação (a que vem DEPOIS do rótulo, não a de emissão)", () => {
    const r = parseComprovanteArrecadacao(COMPROVANTE_COM_ACRESCIMO);
    expect(r.dataArrecadacaoBR).toBe("04/08/2026");
  });

  it("comprovante de item único, sem bloco Totais, usa a linha de composição", () => {
    const r = parseComprovanteArrecadacao(COMPROVANTE_SEM_TOTAIS);
    expect(r.principal).toBeCloseTo(178.31, 2);
    expect(r.multa).toBeCloseTo(12.94, 2);
    expect(r.confiavel).toBe(true);
  });

  it("⚠ soma que não fecha devolve SÓ o total e `confiavel: false`", () => {
    // É o sinal que faz a baixa automática se recusar a lançar. Sem ele, um split errado viraria
    // lançamento contábil errado, silenciosamente.
    const r = parseComprovanteArrecadacao(COMPROVANTE_INCOERENTE);
    expect(r.confiavel).toBeFalsy();
    expect(r.principal).toBeNull();
    expect(r.juros).toBeNull();
    expect(r.multa).toBeNull();
    expect(r.total).toBeCloseTo(200, 2);
  });

  it("texto vazio não quebra", () => {
    const r = parseComprovanteArrecadacao("");
    expect(r.confiavel).toBeFalsy();
  });
});
