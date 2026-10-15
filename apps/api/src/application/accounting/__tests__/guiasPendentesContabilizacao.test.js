jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../GuideToProvisionService.js", () => ({ generateProvisionsFromGuide: jest.fn() }));
import { listarGuiasPendentesContabilizacao, contabilizarGuiaPendente } from "../GuiasPendentesContabilizacaoService.js";
import { generateProvisionsFromGuide } from "../GuideToProvisionService.js";

const updatedAt = new Date("2026-10-15T18:00:00Z");
let db;
beforeEach(() => {
  jest.clearAllMocks();
  db = {
    guide: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => ({ id: "guia", portalClientId: "empresa", competencia: "2026-09", updatedAt, extracted: { contabilizacaoPendente: { motivo: "MES_FECHADO" }, composicao: [{ codigo: "2172" }] } })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    companyMonthlyCircular: { findUnique: jest.fn(async () => ({ fechadoContabilEm: null })) },
    $transaction: jest.fn(fn => fn(db)),
  };
  generateProvisionsFromGuide.mockResolvedValue({ ok: true, entries: [{ entryId: "entry" }] });
});
const run = () => contabilizarGuiaPendente({ portalClientId: "empresa", guideId: "guia", updatedAt }, db);

test("lista somente pendências da empresa e competência", async () => {
  await listarGuiasPendentesContabilizacao({ portalClientId: "empresa", competencia: "2026-09" }, db);
  expect(db.guide.findMany.mock.calls[0][0].where).toMatchObject({ portalClientId: "empresa", competencia: "2026-09", extracted: { path: ["contabilizacaoPendente", "motivo"], equals: "MES_FECHADO" } });
});
test("mês fechado conserva a pendência sem gerar lançamentos", async () => {
  db.companyMonthlyCircular.findUnique.mockResolvedValue({ fechadoContabilEm: new Date() });
  await expect(run()).rejects.toMatchObject({ code: "MES_FECHADO" });
  expect(generateProvisionsFromGuide).not.toHaveBeenCalled();
  expect(db.guide.updateMany).not.toHaveBeenCalled();
});
test("após reabertura, gera provisão e remove somente a pendência na mesma transação", async () => {
  await expect(run()).resolves.toMatchObject({ ok: true, lancamentos: 1 });
  expect(generateProvisionsFromGuide).toHaveBeenCalledWith({ guideId: "guia", tx: db });
  expect(db.guide.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "guia", portalClientId: "empresa", updatedAt }, data: { extracted: { composicao: [{ codigo: "2172" }] } } });
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
});
test("guia de outra empresa não é contabilizada", async () => {
  db.guide.findFirst.mockResolvedValue(null);
  await expect(run()).rejects.toMatchObject({ status: 404 });
  expect(db.guide.findFirst.mock.calls[0][0].where.portalClientId).toBe("empresa");
  expect(generateProvisionsFromGuide).not.toHaveBeenCalled();
});
test("revisão antiga é recusada", async () => {
  await expect(contabilizarGuiaPendente({ portalClientId: "empresa", guideId: "guia", updatedAt: "2026-10-01" }, db)).rejects.toMatchObject({ code: "GUIA_ALTERADA" });
  expect(generateProvisionsFromGuide).not.toHaveBeenCalled();
});
test("lançamento exportado mantém a pendência para revisão", async () => {
  generateProvisionsFromGuide.mockResolvedValue({ ok: true, entries: [{ action: "skipped_exported" }] });
  await expect(run()).rejects.toMatchObject({ code: "GUIA_LANCAMENTO_EXPORTADO" });
  expect(db.guide.updateMany).not.toHaveBeenCalled();
});
test("repetição já resolvida não gera provisões novamente", async () => {
  db.guide.findFirst.mockResolvedValue({ id: "guia", extracted: {}, updatedAt });
  await expect(run()).resolves.toMatchObject({ jaContabilizada: true });
  expect(generateProvisionsFromGuide).not.toHaveBeenCalled();
});
