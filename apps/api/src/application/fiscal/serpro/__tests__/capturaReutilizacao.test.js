import { capturePgdasGuideForCompany } from "../CaptureSerproGuidesService.js";
import { syncSerproInssForCompany } from "../SerproDctfwebService.js";
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { SerproPgdasdService } from "../SerproPgdasdService.js";
jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: { portalClient: { findUnique: jest.fn() }, guide: { findFirst: jest.fn() }, companyMonthlyCircular: { findFirst: jest.fn() } } }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: async () => ({ certificate: { document: "12345678000199" } }) }));
jest.mock("../SerproPgdasdService.js", () => ({ SERPRO_PGDASD_SERVICE_NORMAL: "GERARDAS12", SERPRO_PGDASD_SERVICE_COBRANCA: "GERARDASCOBRANCA17", SerproPgdasdService: jest.fn() }));
jest.mock("../../../guides/GuideService.js", () => ({ toGuideResponse: g => ({ guideId: g.id }), PUBLICO: { ESCRITORIO: "ESCRITORIO" } }));
const input = { portalClientId: "c1", competencia: "2026-08" };
beforeEach(() => { jest.clearAllMocks(); prisma.portalClient.findUnique.mockResolvedValue({ id: "c1", cnpj: "12345678000199" }); prisma.guide.findFirst.mockResolvedValue({ id: "g1", pdfBytes: Buffer.from("pdf") }); prisma.companyMonthlyCircular.findFirst.mockResolvedValue({ id: "circular" }); });
test("guia salva evita cliente fiscal e exclui parcelas", async () => {
  expect(await capturePgdasGuideForCompany(input)).toMatchObject({ reutilizado: true, guide: { guideId: "g1" } });
  expect(SerproPgdasdService).not.toHaveBeenCalled();
  expect(prisma.guide.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ portalClientId: "c1", competencia: "2026-08", parcelamentoId: null }) }));
});

test("INSS salvo preserva resultado encontrado sem afirmar nova emissão", async () => {
  expect(await syncSerproInssForCompany(input)).toMatchObject({ reutilizado: true, guide: { guideId: "g1" }, inss: { status: "REUSED", competencia: "2026-08" } });
  expect(prisma.guide.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tipo: "INSS", parcelamentoId: null }) }));
});
test.each([{ atualizar: true }, { existingGuideId: "g1" }, { dataConsolidacao: "20260909" }])("recálculo explícito ignora arquivo anterior: %j", async extra => {
  const emitir = jest.fn(async () => { throw new Error("CHAMADA_FISCAL_SIMULADA"); });
  SerproPgdasdService.mockImplementation(() => ({ emitirDasNormal: emitir, emitirDasCobranca: emitir }));
  await expect(capturePgdasGuideForCompany({ ...input, ...extra })).rejects.toThrow("CHAMADA_FISCAL_SIMULADA");
  expect(emitir).toHaveBeenCalledTimes(1); expect(prisma.guide.findFirst).not.toHaveBeenCalled();
});
