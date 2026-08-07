// A CLASSIFICAÇÃO DO DOCUMENTO ARRECADADO — pelos mesmos 5 comprovantes reais.
//
// ⚠ O QUE ESTES TESTES PROTEGEM é a fronteira entre "parcela de parcelamento" e "recolhimento em
// atraso". As duas trazem multa e juros; só uma debita o passivo de um parcelamento. Confundi-las
// significa baixar dívida que não existe, ou lançar despesa que já foi reconhecida.

import { parseComposicaoComprovante } from "../parseComposicaoComprovante";
import { classificarDocumentoArrecadado, TIPO_DOCUMENTO, CODIGOS_TJLP_PARCELAMENTO } from "../classificarDocumentoArrecadado";

const COMPROVANTES = {
  R1: "Composição do Documento de Arrecadação\n2089IRPJ - Lucro presumido163,4032,6614,52210,58\n0380TJLP - IRPJ - Parcelamentos--11,7811,78\n01 - TJLP IRPJ - PARCELAMENTO\n8109PIS - Faturamento23,024,601,4629,08\n0389TJLP - PIS - Parcelamentos--1,621,62\n01 - TJLP PIS - PARCELAMENTO\n2372CSLL - PJ que apuram IRPJ base lucro presumido ou98,0119,608,71126,32\n0391TJLP - CSLL - Parcelamentos--7,067,06\n01 - TJLP CSLL - PARCELAMENTO\n2172COFINS - Contribuição para financiamento da segurid. social108,1521,624,85134,62\n0387TJLP - COFINS - Parcelamentos--7,527,52\n01 - TJLP COFINS - PARCELAMENTO\nTotais\n392,5878,4857,52528,58",
  R3: "Composição do Documento de Arrecadação\n2089IRPJ - Lucro presumido27.874,56--27.874,56\n01 - IRPJ - LUCRO PRESUMIDO\n2372CSLL - PJ que apuram IRPJ base lucro presumido ou10.754,85--10.754,85\n01 - CSLL - LUCRO PRESUMIDO OU ARBITRADO - ENTIDADE NÃO\nTotais\n38.629,410,000,0038.629,41",
  R4: "Composição do Documento de Arrecadação\n2172COFINS - Contribuição para financiamento da segurid. social11.597,36--11.597,36\n01 - COFINS - FATURAMENTO/PJ EM GERAL\n8109PIS - Faturamento2.512,76--2.512,76\n02 - PIS - FATURAMENTO - PJ EM GERAL\nTotais\n14.110,120,000,0014.110,12",
  R5: "Composição do Documento de Arrecadação\n8109PIS - Faturamento90,8718,172,42111,46\n3208IRRF - Aluguéis e royalties pagos a PF6,411,280,287,97\n2172COFINS - Contribuição para financiamento da segurid. social419,4783,8811,18514,53\nTotais\n516,75103,3313,88633,96",
};

const classificar = (chave, opts) => classificarDocumentoArrecadado(parseComposicaoComprovante(COMPROVANTES[chave]), opts);

describe("R1 — parcela de parcelamento", () => {
  const c = classificar("R1");

  it("classifica pelo CÓDIGO de TJLP presente na composição", () => {
    expect(c.classificavel).toBe(true);
    expect(c.tipo).toBe(TIPO_DOCUMENTO.PARCELA_PARCELAMENTO);
    expect(c.itensTjlp.map((i) => i.codigo)).toEqual(["0380", "0389", "0391", "0387"]);
    expect(c.itensTributo.map((i) => i.codigo)).toEqual(["2089", "8109", "2372", "2172"]);
  });

  it("⚠ O LANÇAMENTO: D passivo 500,60 · D despesa 27,98 · C caixa 528,58", () => {
    // A amortização leva principal, multa E juros dos códigos-tributo — os três são dívida
    // consolidada. Só o TJLP é encargo do mês.
    expect(c.amortizacao).toEqual({ principal: 392.58, multa: 78.48, juros: 29.54, total: 500.6 });
    expect(c.encargoCorrente).toBe(27.98);
  });

  it("⚠ e o lançamento FECHA: amortização + encargo == total do documento", () => {
    // A identidade que impede o balanço de quebrar em silêncio.
    expect(c.amortizacao.total + c.encargoCorrente).toBe(528.58);
  });

  it("o texto confirma o código, sem alerta", () => {
    expect(c.alertas).toEqual([]);
  });
});

describe("R3 e R4 — recolhimento normal", () => {
  it("sem TJLP e sem acréscimo = RECOLHIMENTO_NORMAL", () => {
    expect(classificar("R3").tipo).toBe(TIPO_DOCUMENTO.RECOLHIMENTO_NORMAL);
    expect(classificar("R4").tipo).toBe(TIPO_DOCUMENTO.RECOLHIMENTO_NORMAL);
  });

  it("nada vira encargo corrente, e a amortização não se aplica a passivo nenhum", () => {
    const c = classificar("R3");
    expect(c.encargoCorrente).toBe(0);
    expect(c.itensTjlp).toEqual([]);
    expect(c.amortizacao.total).toBe(38629.41);
  });
});

describe("R5 — ⚠ acréscimo NÃO é parcelamento", () => {
  const c = classificar("R5");

  it("multa e juros em todos os itens, e ainda assim é RECOLHIMENTO_EM_ATRASO", () => {
    // O caso que separa "tem juros" de "é parcelamento". Classificar por acréscimo debitaria um
    // passivo de parcelamento que esta empresa não tem para estes tributos.
    expect(c.tipo).toBe(TIPO_DOCUMENTO.RECOLHIMENTO_EM_ATRASO);
    expect(c.itensTjlp).toEqual([]);
    expect(c.encargoCorrente).toBe(0);
  });

  it("o IRRF entra itemizado, não diluído nos outros", () => {
    expect(c.itensTributo.find((i) => i.codigo === "3208").total).toBe(7.97);
  });
});

describe("⚠ código × texto: o texto confere, nunca classifica", () => {
  it("código desconhecido com 'PARCELAMENTO' no texto ALERTA, e NÃO vira parcelamento", () => {
    // Pode ser TJLP de uma modalidade que não mapeamos — e pode não ser. Adivinhar debitaria um
    // passivo pelo palpite.
    const texto = COMPROVANTES.R5.replace("3208IRRF - Aluguéis e royalties pagos a PF", "9999TJLP - XPTO - Parcelamentos");
    const c = classificarDocumentoArrecadado(parseComposicaoComprovante(texto));
    expect(c.tipo).toBe(TIPO_DOCUMENTO.RECOLHIMENTO_EM_ATRASO);
    expect(c.alertas).toEqual([
      { tipo: "codigo_desconhecido_com_texto_de_parcelamento", codigo: "9999", denominacao: "TJLP - XPTO - Parcelamentos" },
    ]);
  });

  it("código de TJLP com texto que não fala em parcelamento vira revisão humana", () => {
    const texto = COMPROVANTES.R1.replace("0380TJLP - IRPJ - Parcelamentos", "0380IRPJ - outra coisa qualquer");
    const c = classificarDocumentoArrecadado(parseComposicaoComprovante(texto));
    expect(c.tipo).toBe(TIPO_DOCUMENTO.PARCELA_PARCELAMENTO);   // o código manda
    expect(c.alertas[0]).toMatchObject({ tipo: "divergencia_codigo_texto", codigo: "0380" });
  });

  it("a tabela de códigos é injetável — vira dado versionado sem esta função mudar", () => {
    const c = classificarDocumentoArrecadado(parseComposicaoComprovante(COMPROVANTES.R5), {
      codigosTjlp: { 3208: "TJLP - inventado só para este teste" },
    });
    expect(c.tipo).toBe(TIPO_DOCUMENTO.PARCELA_PARCELAMENTO);
    expect(c.encargoCorrente).toBe(7.97);
  });

  it("a semente cobre os quatro códigos vistos nos comprovantes reais", () => {
    expect(Object.keys(CODIGOS_TJLP_PARCELAMENTO).sort()).toEqual(["0380", "0387", "0389", "0391"]);
  });
});

describe("⚠ composição não confiável NÃO classifica", () => {
  it("lista vazia não vira 'recolhimento normal'", () => {
    // Seria a afirmação mais tranquilizadora possível no exato momento em que não se leu o
    // documento: "nada a acrescentar, tudo em dia".
    const c = classificarDocumentoArrecadado({ confiavel: false, itens: [], motivo: "item_nao_fecha:8109" });
    expect(c.classificavel).toBe(false);
    expect(c.tipo).toBeNull();
    expect(c.motivo).toBe("item_nao_fecha:8109");
  });

  it("entrada ausente não quebra", () => {
    expect(classificarDocumentoArrecadado(null).classificavel).toBe(false);
    expect(classificarDocumentoArrecadado(undefined).motivo).toBe("composicao_ausente");
  });
});
