jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: { guide: { findUnique: jest.fn(), findMany: jest.fn() }, appSetting: { findUnique: jest.fn(), upsert: jest.fn() } } }));
jest.mock("../SerproPagtoWebService.js", () => ({ confirmarPagamento: jest.fn() }));
jest.mock("../SerproPgdasDeclaracaoService.js", () => ({ consultarDasIndexPorCompetencia: jest.fn() }));
jest.mock("../../../guides/GuideStorageService.js", () => ({ GuideStorageService: {} }));
jest.mock("../../../guides/GuidePaymentStatusService.js", () => ({ isGuidePaid: g => g.paymentStatus === "PAID", markGuideOpenBySerpro: jest.fn(), markGuidePaidByComprovante: jest.fn(), CHECK_RESULT_NAO_LOCALIZADO: "NAO_LOCALIZADO" }));
jest.mock("../../../guides/AvisoPagamentoService.js", () => ({ avisarPagamentoNaoConfirmado: jest.fn(async () => ({ status: "ENVIADO" })) }));
jest.mock("../../../accounting/InssPagamentoService.js", () => ({ gerarPagamentoInssFromGuide: jest.fn() }));
jest.mock("../../../accounting/parcelamento/ParcelamentoV2Service.js", () => ({ recalcularEstadosParcelasEmAberto: jest.fn(async () => ({})), gerarPagamentoParcelaFromGuide: jest.fn() }));
jest.mock("../CompanyRotinasService.js", () => ({ idsComRotinaAtiva: jest.fn(async () => new Set(["c"])) }));
jest.mock("../SerproParcelaPagamentoService.js", () => ({ confirmarPagamentoParcela: jest.fn(), confirmarPagamentosParcelasEmLote: jest.fn(async () => ({ total: 0, results: [] })) }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { confirmarPagamento } from "../SerproPagtoWebService.js";
import { consultarDasIndexPorCompetencia } from "../SerproPgdasDeclaracaoService.js";
import { avisarPagamentoNaoConfirmado } from "../../../guides/AvisoPagamentoService.js";
import { confirmarPagamentoGuia, runPaymentConfirmationOnce } from "../SerproPaymentConfirmationService.js";
const scheduledAt = "2026-09-24T11:00:00Z";
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-24T15:00:00Z"));
  jest.clearAllMocks(); const ledger = new Map();
  prisma.appSetting.findUnique.mockImplementation(async ({ where }) => ledger.get(where.key));
  prisma.appSetting.upsert.mockImplementation(async ({ create }) => { ledger.set(create.key, create); return create; });
  prisma.guide.findUnique.mockResolvedValue({ id: "g", tipo: "SIMPLES", competencia: "2026-09", vencimento: "2026-09-20", portalClientId: "c", portalClient: { cnpj: "11111111000191" }, paymentStatus: "OPEN" });
  prisma.guide.findMany.mockResolvedValue([{ id: "g", tipo: "SIMPLES", competencia: "2026-09", portalClientId: "c" }]);
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: false });
  avisarPagamentoNaoConfirmado.mockResolvedValue({ status: "ENVIADO" });
});
afterEach(() => jest.useRealTimers());
test.each(["2026-09-24", "2026-09-25", null])("automático não consulta hoje/futuro/data desconhecida %s", async vencimento => {
  const g = await prisma.guide.findUnique(); prisma.guide.findUnique.mockResolvedValue({ ...g, vencimento });
  const r = await confirmarPagamentoGuia({ guideId: "g", scheduledAt });
  expect(r.skipped).toBe(vencimento ? "ainda_nao_vencida" : "sem_vencimento_confirmado");
  expect(consultarDasIndexPorCompetencia).not.toHaveBeenCalled();
});
test("declaração CLIENTE pode ser conferida manualmente, mas nunca gera consulta automática", async () => {
  const g = await prisma.guide.findUnique(); prisma.guide.findUnique.mockResolvedValue({ ...g, paymentStatus: "PAID", paymentStatusSource: "CLIENTE", clienteConfirmouEm: new Date() });
  expect((await confirmarPagamentoGuia({ guideId: "g", scheduledAt })).skipped).toBe("already_paid");
  await confirmarPagamentoGuia({ guideId: "g" }); expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(1);
});
test("negativa fresca avisa uma vez; outra agenda não consulta a obrigação, manual pode consultar", async () => {
  const first = await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt });
  expect(first.avisosEnviados).toBe(1);
  await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt: "2026-09-25T11:00:00Z" });
  expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(1);
  // Pode retomar aviso reservado após reinício; o serviço de aviso deduplica o transporte.
  expect(avisarPagamentoNaoConfirmado).toHaveBeenCalledTimes(2);
  await confirmarPagamentoGuia({ guideId: "g" });
  expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(2);
});
test.each([null, { dasPago: null }])("índice indisponível nunca vira aviso negativo %j", async idx => {
  consultarDasIndexPorCompetencia.mockResolvedValue(idx);
  expect((await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt })).errors).toBe(1);
  expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled(); expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
test("falha técnica não notifica e pago automático faz somente a consulta de índice", async () => {
  consultarDasIndexPorCompetencia.mockRejectedValueOnce(Error("timeout"));
  await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt });
  expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled();
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: true, numeroDocumento: "123" });
  await confirmarPagamentoGuia({ guideId: "g", scheduledAt });
  expect(confirmarPagamento).not.toHaveBeenCalled();
});
test("falha após persistir negativa retoma só aviso, nunca outra consulta fiscal", async () => {
  avisarPagamentoNaoConfirmado.mockRejectedValueOnce(Error("banco do aviso indisponível"));
  expect((await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt })).errors).toBe(1);
  const r = await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt: "2026-09-25T11:00:00Z" });
  expect(r.avisosEnviados).toBe(1); expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(1);
});
