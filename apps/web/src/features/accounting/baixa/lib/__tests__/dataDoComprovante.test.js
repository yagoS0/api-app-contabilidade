import { dataDoComprovante } from "../dataDoComprovante";
test.each([
  [{ dataArrecadacao: "20/09/2026" }, "2026-09-20"],
  [{ dataArrecadacao: "2026-09-20" }, "2026-09-20"],
  [{ dataArrecadacao: "2026-09-20T00:00:00Z" }, "2026-09-20"],
  [{ dataArrecadacaoBR: "20/09/2026" }, "2026-09-20"],
  [{ dataArrecadacao: "", dataArrecadacaoBR: "20/09/2026" }, "2026-09-20"],
  [{ dataArrecadacao: "31/02/2026" }, null],
  [{ dataArrecadacao: "desconhecida" }, null],
  [{}, null],
])("normaliza a data civil sem usar hoje: %j", (entrada, saida) => {
  expect(dataDoComprovante(entrada)).toBe(saida);
});
