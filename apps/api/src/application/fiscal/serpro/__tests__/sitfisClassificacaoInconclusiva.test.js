import { classificarTextoSitfis, deriveSituacaoFiscal } from "../sitfisSituacao.js";

test.each([null, "", "   ", "Documento ilegível", "MINISTÉRIO DA FAZENDA CNPJ 00.000.000/0001-00"])("texto insuficiente não comprova regularidade: %s", texto => {
  expect(classificarTextoSitfis(texto)).toBe("INCONCLUSIVO");
});
test("mantém processamento separado de ausência de texto", () => {
  expect(deriveSituacaoFiscal({ processando: true })).toBe("PROCESSANDO");
});
test("declaração explícita de ausência e dívida na PGFN não se anulam", () => {
  expect(classificarTextoSitfis("Não foram detectadas pendências.\nPGFN DEVEDOR")).toBe("COM_PENDENCIA");
  expect(classificarTextoSitfis("Não foram detectadas pendências.")).toBe("REGULAR");
  expect(classificarTextoSitfis("Não foram detectadas pendências.")).toBe("REGULAR");
});
