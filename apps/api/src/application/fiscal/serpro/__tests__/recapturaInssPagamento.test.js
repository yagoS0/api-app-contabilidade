jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {
  portalClient: { findUnique: jest.fn() }, guide: { findFirst: jest.fn(), deleteMany: jest.fn() },
  companyMonthlyCircular: { findUnique: jest.fn(), upsert: jest.fn() },
} }));
jest.mock("../reutilizarGuia.js", () => ({ reutilizarGuia: jest.fn(async () => null) }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: async () => ({ certificate: { document: "12345678000199" } }) }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn() }));
jest.mock("../../../guides/GuideStorageService.js", () => ({ GuideStorageService: { create: () => ({ upload: async () => ({ key: "mock.pdf" }) }) } }));
jest.mock("../../../guides/GuideService.js", () => ({ createOrUpdateGuideFromProcessing: jest.fn(async () => ({ id: "g1" })), hashPdf: () => "hash", toGuideResponse: g => g, PUBLICO: { ESCRITORIO: "ESCRITORIO" } }));
jest.mock("../../circularAcrescimos.js", () => ({ gravarAcrescimoCircular: jest.fn(async () => null) }));
jest.mock("../parseArrecadacao.js", () => ({ parseArrecadacaoComposicao: () => ({ itens: [{ codigo: "1099", principal: 1000, juros: 80, multa: 20, total: 1100 }], totais: { principal: 1000, juros: 80, multa: 20, total: 1100 } }), tributosSeNaoForPrevidenciario: () => null }));
jest.mock("pdf-parse", () => jest.fn(async () => ({ text: "Valor Total 1.100,00\nVencimento 20/07/2026" })));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { SerproHttpClient } from "../SerproHttpClient.js";
import { syncSerproInssForCompany } from "../SerproDctfwebService.js";
import { gravarAcrescimoCircular } from "../../circularAcrescimos.js";
import { createOrUpdateGuideFromProcessing } from "../../../guides/GuideService.js";
const original = { id: "c1", inssTotal: 1000, acrescimos: { INSS: { principal: 1000, juros: 0, multa: 0 } } };
beforeEach(() => {
  jest.clearAllMocks();
  prisma.portalClient.findUnique.mockResolvedValue({ id: "p1", cnpj: "12345678000199" });
  prisma.guide.findFirst.mockResolvedValue({ id: "g1", paymentStatus: "PAID", paymentStatusSource: "MANUAL" });
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue(original);
  prisma.companyMonthlyCircular.upsert.mockResolvedValue(original);
  SerproHttpClient.mockImplementation(() => ({ post: jest.fn(async path => path === "/Consultar" ? { recibo: "123" } : { pdf: Buffer.from("%PDF" + "mock".repeat(80)).toString("base64") }) }));
});
test("nova cobrança preserva composição conferida e guarda composição documental separada", async () => {
  await syncSerproInssForCompany({ portalClientId: "p1", competencia: "2026-06", atualizar: true });
  expect(gravarAcrescimoCircular).toHaveBeenCalledWith(expect.objectContaining({ valores: {} }));
  expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledWith(expect.objectContaining({
    existingGuideId: "g1", parsed: expect.objectContaining({ valor: 1100 }),
    extracted: expect.objectContaining({ composicaoTotais: { principal: 1000, juros: 80, multa: 20, total: 1100 } }),
  }));
});
test("circular fechada não é regravada pela recaptura", async () => {
  const fechada = { ...original, fechadoContabilEm: new Date("2026-08-01") };
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue(fechada);
  const r = await syncSerproInssForCompany({ portalClientId: "p1", competencia: "2026-06", atualizar: true });
  expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled();
  expect(gravarAcrescimoCircular).not.toHaveBeenCalled();
  expect(r.circular).toBe(fechada);
  expect(createOrUpdateGuideFromProcessing).toHaveBeenCalledTimes(1);
});
