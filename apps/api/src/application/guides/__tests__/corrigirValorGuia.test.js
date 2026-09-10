jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../GuideService.js", () => ({ getGuidePdfBuffer: jest.fn() }));
import { preverCorrecaoValorGuia, corrigirValorGuia } from "../CorrigirValorGuiaService.js";
function setup(overrides = {}) {
  const guia = { id: "g", portalClientId: "A", tipo: "OUTRA", status: "PROCESSED", competencia: "2026-08", valor: 100,
    updatedAt: new Date("2026-09-01Z"), pdfBytes: Buffer.from("%PDF-test"), tributosParcela: [], paymentStatus: "OPEN", liberadaCliente: true,
    accountingEntries: [{ id: "e", portalClientId: "A", status: "RASCUNHO", tipo: "PROVISAO", competencia: "2026-08", statusPagamento: "ABERTO", baixas: [], lines: [{ id: "d", tipo: "D", valor: 100 }, { id: "c", tipo: "C", valor: 100 }] }], ...overrides };
  const db = {
    guide: { findFirst: jest.fn(async ({where}) => where.portalClientId === "A" ? structuredClone(guia) : null), updateMany: jest.fn(async () => ({ count: 1 })) },
    companyMonthlyCircular: { findMany: jest.fn(async () => []) },
    accountingEntryLine: { updateMany: jest.fn() }, accountingEntry: { update: jest.fn() }, appSetting: { create: jest.fn() },
  };
  db.$transaction = jest.fn(async fn => fn(db));
  return { db, carregarPdf: jest.fn(async g => g.pdfBytes), ler: jest.fn(async () => ({ linhaDigitavel: "123", linhaDigitavelLidaEm: new Date(), linhaDigitavelMotivo: null, linhaDigitavelValorLidoCentavos: null })) };
}
const args = { companyId: "A", guideId: "g", valor: 826.66 };
test("prévia não altera; aplicação preserva PDF, pagamento e histórico e atualiza provisão balanceada", async () => {
  const deps = setup();
  const previa = await preverCorrecaoValorGuia(args, deps);
  expect(deps.db.guide.updateMany).not.toHaveBeenCalled();
  expect(previa).toMatchObject({ valorAtual: 100, novoValor: 826.66, lancamentosAfetados: 1 });
  await corrigirValorGuia({ ...args, revisao: previa.revisao, userId: "u" }, deps);
  const data = deps.db.guide.updateMany.mock.calls[0][0].data;
  expect(data.valor).toBe(826.66);
  for (const key of ["pdfBytes", "hash", "paymentStatus", "emailStatus", "liberadaCliente", "valorOriginal"]) expect(data[key]).toBeUndefined();
  expect(deps.db.accountingEntryLine.updateMany).toHaveBeenCalledWith({ where: { entryId: "e" }, data: { valor: 826.66 } });
  expect(deps.db.appSetting.create).toHaveBeenCalled();
  expect(deps.db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
});
test.each([{ paymentStatus: "PAID" }, { baixada: true }, { tipo: "SIMPLES" }, { parcelamentoId: "p" }, { tributosParcela: [{ id: "t" }] }])("recusa revisão automática com guarda %j", async patch => {
  const deps = setup(patch);
  await expect(preverCorrecaoValorGuia(args, deps)).rejects.toHaveProperty("code");
  expect(deps.ler).not.toHaveBeenCalled();
});
test("recusa lançamento confirmado e mês fechado", async () => {
  const deps = setup(); const g = await deps.db.guide.findFirst({ where: { portalClientId: "A" } });
  g.accountingEntries[0].status = "EXPORTADO"; deps.db.guide.findFirst.mockResolvedValueOnce(g);
  await expect(preverCorrecaoValorGuia(args, deps)).rejects.toMatchObject({ code: "provisao_nao_editavel" });
  deps.db.companyMonthlyCircular.findMany.mockResolvedValue([{ competencia: "2026-08", fechadoContabilEm: new Date() }]);
  await expect(preverCorrecaoValorGuia(args, deps)).rejects.toMatchObject({ code: "competencia_fechada" });
});
test("PDF não confirmado ou revisão obsoleta impede escrita", async () => {
  const deps = setup();
  deps.ler.mockResolvedValueOnce({ linhaDigitavel: null, linhaDigitavelMotivo: "valor_divergente" });
  await expect(preverCorrecaoValorGuia(args, deps)).rejects.toMatchObject({ code: "pdf_nao_confirma_valor" });
  await expect(corrigirValorGuia({ ...args, revisao: "obsoleta", userId: "u" }, deps)).rejects.toMatchObject({ code: "guia_alterada" });
  expect(deps.db.$transaction).not.toHaveBeenCalled();
});
test("empresa do path restringe a guia", async () => {
  await expect(preverCorrecaoValorGuia({ ...args, companyId: "B" }, setup())).rejects.toMatchObject({ status: 404 });
});
