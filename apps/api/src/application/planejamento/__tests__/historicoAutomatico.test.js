jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../notas/apuracao/v2/FechamentoService.js", () => ({ whereFaturamentoEmit: () => ({ papel: "EMIT", statusEfetivo: "autorizada" }) }));
import { consolidarHistorico, carregarHistoricoPlanejamento } from "../HistoricoPlanejamentoService.js";
const plano = new Map([["r", { codigoCompleto: "31101" }], ["d", { codigoCompleto: "33101001" }], ["f", { codigoCompleto: "411010001" }], ["b", { codigoCompleto: "111010001" }]]);
const entry = (lines, competencia = "2026-01", status = "CONFIRMADO") => ({ competencia, status, lines });
const line = (conta, tipo, valor) => ({ conta, tipo, valor });
const nota = valor => ({ competencia: new Date("2026-01-01Z"), _sum: { total: valor }, _count: { _all: 1 } });
test("escolhe apuração > notas > lançamentos sem somar a mesma receita", () => {
  const fontes = { notas: [nota(900)], plano, lancamentos: [entry([line("r", "C", 850)])] };
  const r = consolidarHistorico({ ...fontes, snapshots: [{ competencia: "2026-01", estado: "transmitida", receitaInterna: 1000, receitaExterna: 0, dasRetornadoSerpro: 60 }] })[0];
  expect(r).toMatchObject({ receita: 1000, receitaNotas: 900, receitaLancamentos: 850, tributoApurado: 60 });
  expect(r.avisoReceita).toBeTruthy();
  expect(consolidarHistorico(fontes)[0].receita).toBe(900);
  expect(consolidarHistorico({ plano, lancamentos: fontes.lancamentos })[0].receita).toBe(850);
});
test("preserva zero confirmado; ausência e saldo negativo não são receita zero", () => {
  expect(consolidarHistorico({ snapshots: [{ competencia: "2026-01", receitaInterna: 0, receitaExterna: 0 }], notas: [nota(100)] })[0].receita).toBe(0);
  expect(consolidarHistorico({ plano, lancamentos: [entry([line("r", "D", 100)])] })[0].receita).toBeNull();
  expect(consolidarHistorico({ plano, lancamentos: [entry([line("b", "D", 100)])] })[0].receita).toBeNull();
});
test("classifica pela conta, deduz devoluções e ignora rascunhos e pagamentos de passivo", () => {
  const r = consolidarHistorico({ plano, lancamentos: [entry([line("r", "C", 1000), line("b", "D", 1000)]), entry([line("d", "D", 100)]), entry([line("r", "C", 9999)], "2026-01", "RASCUNHO")] });
  expect(r[0].receita).toBe(900);
});
test("folha contábil fica separada da folha fiscal, sem duplicar pagamento", () => {
  const r = consolidarHistorico({ plano, contasFolha: new Set(["f"]), lancamentos: [entry([line("f", "D", 3000)]), entry([line("b", "C", 3000), line("passivo", "D", 3000)])] })[0];
  expect(r).toMatchObject({ folha: null, folhaContabil: 3000 });
});
test("consultas são por empresa, janela anterior e registros autorizados/confirmados", async () => {
  const client = { portalInvoice: { groupBy: jest.fn(async () => []) }, accountingEntry: { findMany: jest.fn(async () => []) }, chartOfAccount: { findMany: jest.fn(async () => []) } };
  await carregarHistoricoPlanejamento({ portalClientId: "e1", referencia: "2026-09", client });
  expect(client.portalInvoice.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: "e1", papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte: new Date("2025-01-01Z"), lt: new Date("2026-10-01Z") } }) }));
  expect(client.accountingEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: "e1", competencia: { gte: "2025-01", lte: "2026-09" }, status: { in: ["CONFIRMADO", "EXPORTADO"] } } }));
  expect(client.chartOfAccount.findMany.mock.calls[0][0].where).toEqual({ OR: [{ portalClientId: "e1" }, { portalClientId: null }] });
});
test("falha de uma fonte preserva as demais e gera aviso", async () => {
  const client = { portalInvoice: { groupBy: jest.fn(async () => { throw new Error("offline"); }) }, accountingEntry: { findMany: jest.fn(async () => []) }, chartOfAccount: { findMany: jest.fn(async () => []) } };
  const r = await carregarHistoricoPlanejamento({ portalClientId: "e1", referencia: "2026-09", snapshots: [{ competencia: "2026-01", receitaInterna: 100, receitaExterna: 0 }], client });
  expect(r.historico[0].receita).toBe(100); expect(r.avisos[0]).toMatch(/notas fiscais/);
});
