import {
  evidenciaConfirmaValor,
  motivoImpedimentoDaGuia,
  valorDaCorrecaoEmCentavos,
} from "./correcaoDeValor.js";

describe("valor da correção da guia", () => {
  test.each([
    ["0.01", 1],
    [0.29, 29],
    ["0007.5", 750],
    ["12.00", 1200],
    [12, 1200],
    ["90071992547409", 9007199254740900],
  ])("converte %p para %p centavos", (entrada, esperado) => {
    expect(valorDaCorrecaoEmCentavos(entrada)).toBe(esperado);
  });

  test.each([
    null, true, {}, 0, "0.00", -1, 1.001, "1.230", "0,01", ".50", "5.",
    " 1.00", "+1", "1e2", NaN, Infinity, "90071992547410",
  ])("recusa %p", entrada => {
    expect(valorDaCorrecaoEmCentavos(entrada)).toBeNull();
  });
});

const guia = { tipo: "OUTRA", status: "PROCESSED", competencia: "2026-08", tributosParcela: [] };

describe("elegibilidade da guia para correção", () => {
  test("aceita guia processada sem impedimentos", () => {
    expect(motivoImpedimentoDaGuia(guia)).toBeNull();
  });

  test.each([
    { tipo: "SIMPLES" }, { parcelamentoId: "parcela" }, { tributosParcela: [{ id: "tributo" }] },
    { status: "PENDING" }, { competencia: null },
  ])("a composição tem precedência mesmo com pagamento: %p", impedimento => {
    expect(motivoImpedimentoDaGuia({ ...guia, baixada: true, ...impedimento })).toEqual({
      code: "correcao_exige_revisao",
      message: "Esta guia exige revisão da composição antes de alterar o valor.",
    });
  });

  test.each([
    { baixada: true }, { paymentStatus: "PAID" }, { paymentConfirmedAt: new Date(0) },
    { clienteConfirmouEm: new Date(0) }, { comprovantePdfFileId: "comprovante" },
  ])("reconhece sinal de pagamento: %p", pagamento => {
    expect(motivoImpedimentoDaGuia({ ...guia, ...pagamento })).toEqual({
      code: "guia_com_pagamento",
      message: "A guia tem registro de pagamento e exige revisão contábil.",
    });
  });
});

describe("confirmação pela evidência do PDF", () => {
  test.each([
    [{ linhaDigitavel: "123", linhaDigitavelMotivo: null }, true],
    [{ linhaDigitavel: "123", linhaDigitavelMotivo: "valor_divergente_do_documento" }, false],
    [{ linhaDigitavel: "", linhaDigitavelMotivo: null }, false],
    [{}, false],
  ])("avalia a leitura %p", (leitura, esperado) => {
    expect(evidenciaConfirmaValor(leitura)).toBe(esperado);
  });
});
