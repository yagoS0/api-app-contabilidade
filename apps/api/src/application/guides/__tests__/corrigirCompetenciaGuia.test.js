jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { preverCorrecaoCompetenciaGuia, corrigirCompetenciaGuia } from "../CorrigirCompetenciaGuiaService.js";
const args = { companyId: "A", guideId: "g", competencia: "2026-09" };
function setup(patch = {}) {
  const g = { id: "g", portalClientId: "A", competencia: "2029-09", tipo: "SIMPLES", status: "PROCESSED", updatedAt: new Date("2026-10-13Z"), valor: 627.01, hash: "original", extracted: { competencia: "2029-09", rawText: "setembro/2026" }, _count: { accountingEntries: 0, composicoesParcelamento: 0, tributosParcela: 0, taxDocuments: 0, envios: 0 }, ...patch };
  const db = { guide: { findFirst: jest.fn(async ({ where }) => typeof where.id === "string" && where.portalClientId === "A" ? structuredClone(g) : null), updateMany: jest.fn(async () => ({ count: 1 })) }, companyMonthlyCircular: { findMany: jest.fn(async () => []) }, appSetting: { create: jest.fn() } };
  db.$transaction = jest.fn(async fn => fn(db));
  return { db, g };
}
test("corrige cadastro sem alterar PDF, valor, vencimento ou criar lançamentos; audita autoria", async () => {
  const deps = setup();
  const previa = await preverCorrecaoCompetenciaGuia(args, deps);
  expect(deps.db.guide.updateMany).not.toHaveBeenCalled();
  await expect(corrigirCompetenciaGuia({ ...args, revisao: previa.revisao, userId: "u" }, deps)).resolves.toEqual({ ok: true, guideId: "g", competencia: "2026-09" });
  const data = deps.db.guide.updateMany.mock.calls[0][0].data;
  expect(Object.keys(data).sort()).toEqual(["competencia", "extracted", "reviewedAt", "reviewedByUserId"]);
  expect(data.extracted).toEqual({ competencia: "2026-09", rawText: "setembro/2026" });
  expect(deps.db.appSetting.create.mock.calls[0][0].data.value).toMatchObject({ userId: "u", competenciaAnterior: "2029-09", competenciaCorrigida: "2026-09", pdfPreservado: true });
  expect(deps.db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
});
test.each([null, "09-2026", "2026-00", "2026-13", "2026-9", "2029-09"])("recusa competência inválida ou igual %s", async competencia => {
  await expect(preverCorrecaoCompetenciaGuia({ ...args, competencia }, setup())).rejects.toHaveProperty("status", 400);
});
test.each([{ paymentStatus: "PAID" }, { baixada: true }, { paymentConfirmedAt: new Date() }, { clienteConfirmouEm: new Date() }, { comprovantePdfFileId: "pdf" }, { parcelamentoId: "p" }, { parcela: { id: "p" } }, { lancamentoId: "e" }, { liberadaCliente: true }, { emailStatus: "SENDING" }, { emailStatus: "SENT" }, { emailSentAt: new Date() }, { status: "VAZIO" }])("recusa mudança com vínculo ou estado %j", async patch => {
  const deps = setup(patch);
  await expect(preverCorrecaoCompetenciaGuia(args, deps)).rejects.toHaveProperty("code");
  expect(deps.db.guide.updateMany).not.toHaveBeenCalled();
});
test.each(["accountingEntries", "composicoesParcelamento", "tributosParcela", "taxDocuments", "envios"])("recusa relação %s", async key => {
  const deps = setup(); deps.g._count[key] = 1;
  await expect(preverCorrecaoCompetenciaGuia(args, deps)).rejects.toHaveProperty("code");
});
test.each(["2029-09", "2026-09"])("recusa mês fechado na origem ou destino %s", async competencia => {
  const deps = setup(); deps.db.companyMonthlyCircular.findMany.mockResolvedValue([{ competencia, fechadoContabilEm: new Date() }]);
  await expect(preverCorrecaoCompetenciaGuia(args, deps)).rejects.toHaveProperty("code", "competencia_fechada");
});
test("não apaga nem substitui guia já existente no destino", async () => {
  const deps = setup(); deps.db.guide.findFirst.mockResolvedValueOnce(deps.g).mockResolvedValueOnce({ id: "outra" });
  await expect(preverCorrecaoCompetenciaGuia(args, deps)).rejects.toHaveProperty("code", "guia_duplicada");
});
test("isola empresa e invalida prévia após mudança ou vínculo novo", async () => {
  const deps = setup();
  await expect(preverCorrecaoCompetenciaGuia({ ...args, companyId: "B" }, deps)).rejects.toHaveProperty("status", 404);
  const p = await preverCorrecaoCompetenciaGuia(args, deps);
  deps.g.updatedAt = new Date();
  await expect(corrigirCompetenciaGuia({ ...args, revisao: p.revisao, userId: "u" }, deps)).rejects.toHaveProperty("code", "guia_alterada");
  deps.g._count.accountingEntries = 1;
  await expect(corrigirCompetenciaGuia({ ...args, revisao: p.revisao, userId: "u" }, deps)).rejects.toHaveProperty("code", "guia_contabilizada");
  expect(deps.db.guide.updateMany).not.toHaveBeenCalled();
});
test("exige autoria/prévia e trata conflito transacional", async () => {
  const deps = setup();
  await expect(corrigirCompetenciaGuia(args, deps)).rejects.toHaveProperty("status", 400);
  deps.db.$transaction.mockRejectedValue({ code: "P2034" });
  await expect(corrigirCompetenciaGuia({ ...args, revisao: "r", userId: "u" }, deps)).rejects.toHaveProperty("code", "guia_alterada");
});
