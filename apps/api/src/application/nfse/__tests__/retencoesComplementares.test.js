import { xmlRetencoesComplementares, normalizarRetencoesComplementares } from "../retencoesComplementares.js";

it("ordem do XSD: CP antes de IRRF; não inventa grupo PIS/COFINS", () => {
  expect(xmlRetencoesComplementares({ vRetIRRF: 15, vRetCP: 110 }, 1000)).toBe("<vRetCP>110.00</vRetCP><vRetIRRF>15.00</vRetIRRF>");
  expect(xmlRetencoesComplementares(null, 1000)).toBe("");
});
it.each([0, -1, 1000, 1001, NaN, Infinity, true, [], "1.005", "1e2"])("recusa valor inválido %s", (vRetIRRF) => {
  expect(() => normalizarRetencoesComplementares({ vRetIRRF }, 1000)).toThrow();
});
it("recusa total excessivo e campo não suportado", () => {
  expect(() => normalizarRetencoesComplementares({ vRetIRRF: 600, vRetCP: 500 }, 1000)).toThrow();
  expect(() => normalizarRetencoesComplementares({ pis: 2 }, 1000)).toThrow();
});
