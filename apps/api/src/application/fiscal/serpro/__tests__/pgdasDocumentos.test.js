import { documentosPgdas, procuracaoPermitePgdas } from "../pgdasDocumentos.js";
const circular = { pgdasNumeroDeclaracao: "123", pgdasDeclaracaoFileId: "d", pgdasReciboFileId: "r", dasTotal: 0 };
test("declaração zerada completa dispensa guia", () => {
  expect(documentosPgdas(circular, null)).toEqual({ declaracao: true, extrato: true, das: true });
});
test("imposto desconhecido não equivale a zero", () => {
  expect(documentosPgdas({ ...circular, dasTotal: null }, null).das).toBe(false);
});
test("PDF da guia ausente não encerra captura", () => {
  expect(documentosPgdas({ ...circular, dasTotal: 10 }, { id: "g" }).das).toBe(false);
});
test.each(["00146", "PGDAS-D - a partir de 01/2018", "PGDASD", "TODOS"])("reconhece escopo %s", s => {
  expect(procuracaoPermitePgdas({ status: "ATIVA", systems: [s] })).toBe(true);
});
test("escopo geral exige procuração ativa e correspondência exata", () => {
  expect(procuracaoPermitePgdas({ status: "AUSENTE", systems: ["TODOS"] })).toBe(false);
  expect(procuracaoPermitePgdas({ status: "ATIVA", systems: ["TODOS OS SERVIÇOS NÃO AUTORIZADOS"] })).toBe(false);
});
test("outro serviço não autoriza", () => {
  expect(procuracaoPermitePgdas({ status: "ATIVA", systems: ["00103"] })).toBe(false);
});
