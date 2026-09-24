jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: { guide: { findMany: jest.fn() } } }));
jest.mock("../../../accounting/parcelamento/ParcelamentoV2Service.js", () => ({ recalcularEstadosParcelasEmAberto: jest.fn(async () => ({})), gerarPagamentoParcelaFromGuide: jest.fn() }));
jest.mock("../CompanyRotinasService.js", () => ({ idsComRotinaAtiva: jest.fn(async () => new Set(["empresa"])) }));
jest.mock("../SerproParcelaPagamentoService.js", () => ({ confirmarPagamentoParcela: jest.fn(), confirmarPagamentosParcelasEmLote: jest.fn(async () => ({ total: 0, results: [] })) }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { runPaymentConfirmationOnce } from "../SerproPaymentConfirmationService.js";
test("guias sem documento no primeiro lote não ocultam a guia 501", async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ id: `g${String(i).padStart(4, "0")}`, tipo: "INSS", extracted: {}, portalClientId: "empresa" }));
  prisma.guide.findMany.mockImplementation(async ({ where, take }) => rows.filter(r => !where.id?.gt || r.id > where.id.gt).slice(0, take));
  const r = await runPaymentConfirmationOnce({ portalClientId: "empresa" });
  expect(r.total).toBe(501);
  expect(r.semDoc).toBe(501);
  expect(prisma.guide.findMany).toHaveBeenCalledTimes(2);
  expect(prisma.guide.findMany.mock.calls[1][0].where).toMatchObject({ portalClientId: "empresa", id: { gt: "g0499" }, parcelamentoId: null });
});
