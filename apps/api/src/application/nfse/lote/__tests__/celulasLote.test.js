// AS TRÊS ARMADILHAS DO EXCEL — o zero do CPF, o `1.500` e a data.
//
// ⚠ NADA AQUI EMITE COISA ALGUMA. São funções puras sobre células.

import {
  lerDocumentoDaPlanilha,
  lerValorDaPlanilha,
  lerCompetenciaDaPlanilha,
  lerEmailDaPlanilha,
  RECUSA_DOCUMENTO,
  RECUSA_VALOR,
  RECUSA_COMPETENCIA,
  RECUSA_EMAIL,
} from "../celulasLote.js";

// CPFs com DV válido, conferíveis à mão pela regra de `utils/cpf.js`.
const CPF_COM_ZERO = "01234567890";
const CPF_COM_DOIS_ZEROS = "00123456797";
const CPF_SEM_ZERO = "12219079724";
const CNPJ = "39254243000191";

describe("documento — o zero que o Excel come", () => {
  it("CNPJ de 14 dígitos passa, com ou sem máscara", () => {
    expect(lerDocumentoDaPlanilha(CNPJ)).toEqual({ ok: true, documento: CNPJ, tipo: "CNPJ", zeroRecuperado: false });
    expect(lerDocumentoDaPlanilha("39.254.243/0001-91").documento).toBe(CNPJ);
  });

  it("CPF de 11 dígitos com DV válido passa", () => {
    expect(lerDocumentoDaPlanilha(CPF_SEM_ZERO)).toEqual({
      ok: true,
      documento: CPF_SEM_ZERO,
      tipo: "CPF",
      zeroRecuperado: false,
    });
  });

  it("⚠ CPF com DV errado é recusado com código PRÓPRIO — o número foi digitado errado", () => {
    expect(lerDocumentoDaPlanilha("12219079725").motivo).toBe(RECUSA_DOCUMENTO.CPF_DV_INVALIDO);
  });

  it("⚠⚠ o zero comido pelo Excel É recuperado — mas SÓ porque o DV fecha com ele de volta", () => {
    // 01234567890 numa célula numérica vira 1234567890 (10 dígitos) — o caso do enunciado.
    expect(lerDocumentoDaPlanilha(1234567890)).toEqual({
      ok: true,
      documento: CPF_COM_ZERO,
      tipo: "CPF",
      zeroRecuperado: true,
    });
    // Dois zeros comidos (9 dígitos) também, pela mesma prova.
    expect(lerDocumentoDaPlanilha(123456797)).toEqual({
      ok: true,
      documento: CPF_COM_DOIS_ZEROS,
      tipo: "CPF",
      zeroRecuperado: true,
    });
  });

  it("⚠⚠ 10 dígitos cujo DV NÃO fecha com o zero recolocado NÃO é consertado", () => {
    // 1221907972 + zero à esquerda = 01221907972, cujo DV não fecha.
    const r = lerDocumentoDaPlanilha(1221907972);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(RECUSA_DOCUMENTO.ZERO_A_ESQUERDA);
  });

  it("⚠⚠ CNPJ de 13 dígitos NUNCA é completado — este projeto não valida DV de CNPJ", () => {
    const r = lerDocumentoDaPlanilha("3925424300019");
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(RECUSA_DOCUMENTO.FORA_DE_FORMA);
  });

  it("comprimentos que não descrevem o erro do Excel viram fora de forma", () => {
    expect(lerDocumentoDaPlanilha("12345678").motivo).toBe(RECUSA_DOCUMENTO.FORA_DE_FORMA); // 8
    expect(lerDocumentoDaPlanilha("123456789012").motivo).toBe(RECUSA_DOCUMENTO.FORA_DE_FORMA); // 12
    expect(lerDocumentoDaPlanilha("123456789012345").motivo).toBe(RECUSA_DOCUMENTO.FORA_DE_FORMA); // 15
  });

  it("célula vazia é ausência", () => {
    expect(lerDocumentoDaPlanilha("").motivo).toBe(RECUSA_DOCUMENTO.AUSENTE);
    expect(lerDocumentoDaPlanilha(null).motivo).toBe(RECUSA_DOCUMENTO.AUSENTE);
    expect(lerDocumentoDaPlanilha("   ").motivo).toBe(RECUSA_DOCUMENTO.AUSENTE);
  });

  it("⚠ o reencaixe NUNCA fabrica sequência repetida — elas passam no módulo 11 e são recusadas", () => {
    // 0000000000 (10 dígitos) → 00000000000, que `cpfTemDvValido` recusa por ser repetida.
    expect(lerDocumentoDaPlanilha("0000000000").ok).toBe(false);
  });
});

describe("valor — o problema do `1.500`", () => {
  it("as formas inequívocas, como texto", () => {
    expect(lerValorDaPlanilha("1500")).toEqual({ ok: true, valor: 1500 });
    expect(lerValorDaPlanilha("1500,00")).toEqual({ ok: true, valor: 1500 });
    expect(lerValorDaPlanilha("1.500,00")).toEqual({ ok: true, valor: 1500 });
    expect(lerValorDaPlanilha("1,500.00")).toEqual({ ok: true, valor: 1500 });
    expect(lerValorDaPlanilha("1500.00")).toEqual({ ok: true, valor: 1500 });
    expect(lerValorDaPlanilha("R$ 1.500,00")).toEqual({ ok: true, valor: 1500 });
    expect(lerValorDaPlanilha("1500,5")).toEqual({ ok: true, valor: 1500.5 });
  });

  it("⚠⚠ `1.500` e `1,500` NÃO são convertidos — duas leituras legítimas", () => {
    expect(lerValorDaPlanilha("1.500").motivo).toBe(RECUSA_VALOR.AMBIGUO);
    expect(lerValorDaPlanilha("1,500").motivo).toBe(RECUSA_VALOR.AMBIGUO);
    expect(lerValorDaPlanilha("1.500.000").motivo).toBe(RECUSA_VALOR.AMBIGUO);
  });

  it("⚠ célula NUMÉRICA é aceita: o Excel já converteu, e o número é o que a pessoa VIU", () => {
    expect(lerValorDaPlanilha(1500)).toEqual({ ok: true, valor: 1500 });
    expect(lerValorDaPlanilha(1.5)).toEqual({ ok: true, valor: 1.5 });
    expect(lerValorDaPlanilha(1500.99)).toEqual({ ok: true, valor: 1500.99 });
  });

  it("⚠ número com mais de duas casas não é valor em reais — e não arredondamos em silêncio", () => {
    expect(lerValorDaPlanilha(1500.005).motivo).toBe(RECUSA_VALOR.CASAS_DEMAIS);
  });

  it("⚠ a aritmética de centavos não sofre com float (0,1 + 0,2)", () => {
    expect(lerValorDaPlanilha(0.1 + 0.2).ok).toBe(true);
    expect(lerValorDaPlanilha("0,30")).toEqual({ ok: true, valor: 0.3 });
  });

  it("zero e negativo são recusados — o validador exige `> 0`", () => {
    expect(lerValorDaPlanilha(0).motivo).toBe(RECUSA_VALOR.NAO_POSITIVO);
    expect(lerValorDaPlanilha("0,00").motivo).toBe(RECUSA_VALOR.NAO_POSITIVO);
    expect(lerValorDaPlanilha(-5).motivo).toBe(RECUSA_VALOR.NAO_POSITIVO);
    expect(lerValorDaPlanilha("-5,00").motivo).toBe(RECUSA_VALOR.ILEGIVEL);
  });

  it("ausente e ilegível têm códigos distintos", () => {
    expect(lerValorDaPlanilha("").motivo).toBe(RECUSA_VALOR.AUSENTE);
    expect(lerValorDaPlanilha(null).motivo).toBe(RECUSA_VALOR.AUSENTE);
    expect(lerValorDaPlanilha("mil e quinhentos").motivo).toBe(RECUSA_VALOR.ILEGIVEL);
  });

  it("valor grande demais para representar sem arredondar", () => {
    expect(lerValorDaPlanilha("99999999999999999").motivo).toBe(RECUSA_VALOR.LONGO);
  });
});

describe("competência", () => {
  const ehODia = (r, iso) => {
    expect(r.ok).toBe(true);
    expect(r.competencia.toISOString().slice(0, 10)).toBe(iso);
  };

  it("dd/mm/aaaa e aaaa-mm-dd", () => {
    ehODia(lerCompetenciaDaPlanilha("31/07/2026"), "2026-07-31");
    ehODia(lerCompetenciaDaPlanilha("2026-07-31"), "2026-07-31");
    ehODia(lerCompetenciaDaPlanilha("1/7/2026"), "2026-07-01");
  });

  it("⚠ célula de data vira DATA CIVIL em meia-noite UTC, pelos componentes LOCAIS", () => {
    // Uma `Date` construída no fuso local, como o `cellDates: true` do SheetJS entrega.
    ehODia(lerCompetenciaDaPlanilha(new Date(2026, 6, 31, 0, 0, 0)), "2026-07-31");
    ehODia(lerCompetenciaDaPlanilha(new Date(2026, 6, 31, 23, 59, 0)), "2026-07-31");
  });

  it("⚠ `dd/mm` NUNCA é lido como `mm/dd`", () => {
    ehODia(lerCompetenciaDaPlanilha("03/07/2026"), "2026-07-03");
  });

  it("⚠ `mm/aaaa` é RECUSADO — escolher o dia 1º seria fabricar um componente", () => {
    expect(lerCompetenciaDaPlanilha("07/2026").motivo).toBe(RECUSA_COMPETENCIA.ILEGIVEL);
  });

  it("data que não existe é recusada — 31/02 não vira 3 de março", () => {
    expect(lerCompetenciaDaPlanilha("31/02/2026").motivo).toBe(RECUSA_COMPETENCIA.ILEGIVEL);
  });

  it("em branco é ausência, com código próprio", () => {
    expect(lerCompetenciaDaPlanilha("").motivo).toBe(RECUSA_COMPETENCIA.AUSENTE);
    expect(lerCompetenciaDaPlanilha(null).motivo).toBe(RECUSA_COMPETENCIA.AUSENTE);
  });

  it("serial do Excel que escapou como número", () => {
    // 46234 = 31/07/2026 na época do Excel (dia 1 = 01/01/1900).
    ehODia(lerCompetenciaDaPlanilha(46234), "2026-07-31");
  });
});

describe("e-mail — só a forma, e o mesmo critério do validador", () => {
  it("em branco é ausência, e ausência não é recusa", () => {
    expect(lerEmailDaPlanilha("")).toEqual({ ok: true, email: null });
    expect(lerEmailDaPlanilha(null)).toEqual({ ok: true, email: null });
  });

  it("com `@` passa", () => {
    expect(lerEmailDaPlanilha(" a@b.com ")).toEqual({ ok: true, email: "a@b.com" });
  });

  it("⚠ sem `@` recusa — e nada mais estrito que isso, senão a planilha recusaria o que a emissão aceita", () => {
    expect(lerEmailDaPlanilha("financeiro").motivo).toBe(RECUSA_EMAIL.FORA_DE_FORMA);
    // O validador (`nfsePayload.js`) só exige o "@" — estes passam lá e passam aqui.
    expect(lerEmailDaPlanilha("a@b").ok).toBe(true);
    expect(lerEmailDaPlanilha("a@b c").ok).toBe(true);
  });
});
