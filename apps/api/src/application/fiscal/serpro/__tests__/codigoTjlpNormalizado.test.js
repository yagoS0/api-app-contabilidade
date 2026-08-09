// OS CÓDIGOS DE TJLP CHEGAM DE DUAS FONTES, ESCRITOS DE FORMAS DIFERENTES.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// `CODIGOS_TJLP_PARCELAMENTO` foi montado a partir do PDF do comprovante, que imprime o código
// **com zero à esquerda** (`"0380"`). Em 2026-08-09 o probe do `PAGAMENTOS71` rodou contra a
// produção e mostrou que a API devolve **sem** (`"380"`) — e trouxe um código que a tabela não
// tinha: **`"16"`, TJLP IRRF - Parcelamento**.
//
// Comparar cru fazia `Object.hasOwn(tabela, "380")` dar false. Todo item de parcelamento vindo da
// consulta escaparia, e o documento cairia em `RECOLHIMENTO_EM_ATRASO`: amortização de
// parcelamento virando despesa de acréscimo, debitando conta errada, **sem nenhum aviso** — porque
// "tem juros" é verdade nos dois casos.
//
// Os valores abaixo são TRANSCRITOS da resposta real (contribuinte 55387580000103, documentos
// 7032620333261786 e 7032614056493560). Fixture inventada é o que fez o `CONSDECCOMPLETA33`
// nascer OFF e continuar OFF.

import {
  classificarDocumentoArrecadado,
  normalizarCodigoReceita,
  CODIGOS_TJLP_PARCELAMENTO,
  TIPO_DOCUMENTO,
} from "../classificarDocumentoArrecadado.js";

/** Item no formato que `parseComposicaoComprovante` produz. */
const item = (codigo, denominacao, principal, multa, juros) => ({
  codigo, denominacao, principal, multa, juros, total: principal + multa + juros,
});

describe("normalizarCodigoReceita", () => {
  it("⚠ as duas escritas do MESMO código colapsam", () => {
    // PDF do comprovante × PAGAMENTOS71.
    expect(normalizarCodigoReceita("0380")).toBe(normalizarCodigoReceita("380"));
    expect(normalizarCodigoReceita("0016")).toBe(normalizarCodigoReceita("16"));
  });

  it("não engole o código inteiro quando ele é só zeros", () => {
    expect(normalizarCodigoReceita("000")).toBe("0");
  });

  it("tolera máscara e ausência", () => {
    expect(normalizarCodigoReceita(" 0380 ")).toBe("380");
    expect(normalizarCodigoReceita(null)).toBe("");
    expect(normalizarCodigoReceita(undefined)).toBe("");
  });
});

describe("a tabela cobre o que a API realmente devolveu", () => {
  // Os cinco vistos na resposta real. O `16` não existia antes deste probe.
  it.each([["380"], ["389"], ["391"], ["387"], ["16"]])("conhece o código %s", (codigo) => {
    expect(Object.keys(CODIGOS_TJLP_PARCELAMENTO).map(normalizarCodigoReceita)).toContain(codigo);
  });
});

describe("documento 7032620333261786 — DARF do LP com parcelamento embutido", () => {
  // ⚠ O caso que mais importa: a mesma DARF traz o tributo CORRENTE e o TJLP do parcelamento.
  // Os pares são (tributo com principal) + (TJLP só com juros).
  const composicao = {
    confiavel: true,
    itens: [
      item("2089", "IRPJ - Lucro Presumido", 687.21, 137.43, 15.95),
      item("380", "TJLP IRPJ - Parcelamento", 0, 0, 64.31),
      item("8109", "PIS - Faturamento", 22.97, 4.59, 0.25),
      item("389", "TJLP PIS - Parcelamento", 0, 0, 2.12),
      item("2372", "CSLL - Lucro Presumido", 287.97, 57.59, 6.8),
      item("391", "TJLP CSLL - Parcelamento", 0, 0, 26.95),
      item("2172", "Cofins", 106.02, 21.2, 1.16),
      item("387", "TJLP Cofins - Parcelamento", 0, 0, 9.82),
    ],
  };

  it("⚠ é classificado como PARCELA_PARCELAMENTO — antes caía em recolhimento em atraso", () => {
    expect(classificarDocumentoArrecadado(composicao).tipo).toBe(TIPO_DOCUMENTO.PARCELA_PARCELAMENTO);
  });

  it("separa os quatro TJLP dos quatro tributos", () => {
    const r = classificarDocumentoArrecadado(composicao);
    expect(r.itensTjlp.map((i) => i.codigo)).toEqual(["380", "389", "391", "387"]);
    expect(r.itensTributo.map((i) => i.codigo)).toEqual(["2089", "8109", "2372", "2172"]);
  });

  it("não levanta divergência código × texto — os dois concordam", () => {
    const r = classificarDocumentoArrecadado(composicao);
    expect(r.alertas).toEqual([]);
  });

  it("classifica igual quando os códigos vêm com zero à esquerda (a fonte PDF)", () => {
    const doPdf = {
      confiavel: true,
      itens: composicao.itens.map((i) => ({ ...i, codigo: i.codigo.padStart(4, "0") })),
    };
    expect(classificarDocumentoArrecadado(doPdf).tipo).toBe(TIPO_DOCUMENTO.PARCELA_PARCELAMENTO);
    expect(classificarDocumentoArrecadado(doPdf).itensTjlp).toHaveLength(4);
  });
});

describe("documento 7032614056493560 — traz o TJLP do IRRF, código 16", () => {
  const composicao = {
    confiavel: true,
    itens: [
      item("8109", "PIS - Faturamento", 90.87, 18.17, 2.42),
      item("389", "TJLP PIS - Parcelamento", 0, 0, 1.11),
      item("3208", "IRRF - Aluguéis e Royalties Pagos a Pessoa Física", 6.41, 1.28, 0.28),
      item("16", "TJLP IRRF - Parcelamento", 0, 0, 0.07),
      item("2172", "Cofins", 419.47, 83.88, 11.18),
      item("387", "TJLP Cofins - Parcelamento", 0, 0, 5.15),
    ],
  };

  it("⚠ o código 16 é reconhecido — ele não existia na tabela antes do probe", () => {
    const r = classificarDocumentoArrecadado(composicao);
    expect(r.itensTjlp.map((i) => i.codigo)).toContain("16");
    expect(r.tipo).toBe(TIPO_DOCUMENTO.PARCELA_PARCELAMENTO);
  });

  it("o IRRF 3208 fica do lado dos TRIBUTOS, não do TJLP", () => {
    // 3208 é o IRRF em si; 16 é o juros do parcelamento DELE. Trocar os dois inverteria o
    // lançamento: despesa de juros virando amortização de passivo.
    const r = classificarDocumentoArrecadado(composicao);
    expect(r.itensTributo.map((i) => i.codigo)).toContain("3208");
    expect(r.itensTjlp.map((i) => i.codigo)).not.toContain("3208");
  });
});

describe("⚠ acréscimo continua NÃO sendo parcelamento", () => {
  it("DARF pago em atraso, sem nenhum TJLP, não vira parcela", () => {
    // A guarda que já existia e não pode ser afrouxada pela normalização: multa e juros existem
    // num recolhimento comum em atraso exatamente como numa parcela.
    const emAtraso = {
      confiavel: true,
      itens: [
        item("8109", "PIS - Faturamento", 22.97, 4.59, 0.25),
        item("2172", "Cofins", 106.02, 21.2, 1.16),
      ],
    };
    expect(classificarDocumentoArrecadado(emAtraso).tipo).toBe(TIPO_DOCUMENTO.RECOLHIMENTO_EM_ATRASO);
  });
});
