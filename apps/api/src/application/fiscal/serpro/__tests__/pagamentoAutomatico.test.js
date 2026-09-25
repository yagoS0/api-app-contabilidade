jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: { guide: { findUnique: jest.fn(), findMany: jest.fn() }, appSetting: { findUnique: jest.fn(), upsert: jest.fn() } } }));
jest.mock("../../../../config.js", () => ({ INTEGRACAO_SERPRO_PAGTOWEB: true, INTEGRACAO_SERPRO_PARCELAMENTO: false }));
jest.mock("../../../guides/ConsultaPagamentoGuiaService.js", () => ({ registrarConsultaPagamentoGuia: jest.fn() }));
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
import { registrarConsultaPagamentoGuia } from "../../../guides/ConsultaPagamentoGuiaService.js";
import { avisarPagamentoNaoConfirmado } from "../../../guides/AvisoPagamentoService.js";
import { confirmarPagamentoGuia, runPaymentConfirmationOnce } from "../SerproPaymentConfirmationService.js";
const scheduledAt = "2026-09-24T11:00:00Z";
const DOC = "07202600000000001";
const evidence = (estado = "NAO_LOCALIZADO", extra = {}) => ({ estado, fonte: "PGDASD_CONSDECLARACAO13", numeroDocumento: DOC,
  consultadoEm: "2026-09-24T15:00:00.000Z", identidadeConferida: true, cobertura: "COMPLETA",
  evidencia: { periodoPgdas: { competencia: "2026-09", cobertura: "COMPLETA", impedimentoAviso: null,
    documentos: [{ numeroDocumento: DOC, dasPago: estado === "CONFIRMADO" }] } }, ...extra });
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-24T15:00:00Z"));
  jest.clearAllMocks(); const ledger = new Map();
  prisma.appSetting.findUnique.mockImplementation(async ({ where }) => ledger.get(where.key));
  prisma.appSetting.upsert.mockImplementation(async ({ create }) => { ledger.set(create.key, create); return create; });
  prisma.guide.findUnique.mockResolvedValue({ id: "g", tipo: "SIMPLES", competencia: "2026-09", vencimento: "2026-09-20", portalClientId: "c", portalClient: { cnpj: "11111111000191" }, paymentStatus: "OPEN", extracted: { numeroDocumento: DOC } });
  prisma.guide.findMany.mockResolvedValue([{ id: "g", tipo: "SIMPLES", competencia: "2026-09", portalClientId: "c" }]);
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: false, numeroDocumento: DOC, resultadoConsulta: evidence() });
  registrarConsultaPagamentoGuia.mockImplementation(async ({ guide, resultadoConsulta }) => {
    const result = { ...resultadoConsulta, consultaId: "consulta", observacaoId: "observacao" };
    const current = { ...guide, extracted: { ...guide.extracted, consultaPagamento: result } };
    prisma.guide.findUnique.mockResolvedValue(current);
    return { guia: current, resultadoConsulta: result, aplicada: true };
  });
  avisarPagamentoNaoConfirmado.mockResolvedValue({ status: "ENVIADO" });
});
afterEach(() => jest.useRealTimers());
test.each(["2026-09-24", "2026-09-25", null])("automático não consulta hoje/futuro/data desconhecida %s", async vencimento => {
  const g = await prisma.guide.findUnique(); prisma.guide.findUnique.mockResolvedValue({ ...g, vencimento });
  const r = await confirmarPagamentoGuia({ guideId: "g", scheduledAt });
  expect(r.skipped).toBe(vencimento ? "ainda_nao_vencida" : "sem_vencimento_confirmado");
  expect(consultarDasIndexPorCompetencia).not.toHaveBeenCalled();
});
test.each(["CONFIRMADO", "NAO_LOCALIZADO"])("declaração CLIENTE continua consultável na agenda mesmo com marcador antigo: %s", async estado => {
  const g = await prisma.guide.findUnique(); prisma.guide.findUnique.mockResolvedValue({ ...g, paymentStatus: "PAID", paymentStatusSource: "CLIENTE", clienteConfirmouEm: new Date() });
  prisma.appSetting.findUnique.mockResolvedValue({ value: { status: "CONFERENCIA_MANUAL" } });
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: estado === "CONFIRMADO", numeroDocumento: DOC, resultadoConsulta: evidence(estado) });
  const r = await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt });
  expect(r[estado === "CONFIRMADO" ? "paid" : "naoLocalizado"]).toBe(1);
  expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(1);
  expect(prisma.guide.findMany.mock.calls[0][0].where.AND).toEqual([{ OR: [
    { paymentStatus: { in: ["OPEN", "OVERDUE"] } }, { paymentStatus: "PAID", paymentStatusSource: "CLIENTE", baixada: false },
  ] }]);
  expect(await prisma.guide.findUnique()).toMatchObject({ paymentStatus: "PAID", paymentStatusSource: "CLIENTE", clienteConfirmouEm: expect.any(Date) });
  expect(prisma.appSetting.upsert).not.toHaveBeenCalled(); expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled();
  expect(confirmarPagamento).not.toHaveBeenCalled();
});
test("declaração CLIENTE continua consultável manualmente", async () => {
  const g = await prisma.guide.findUnique(); prisma.guide.findUnique.mockResolvedValue({ ...g, paymentStatus: "PAID", paymentStatusSource: "CLIENTE", clienteConfirmouEm: new Date() });
  await confirmarPagamentoGuia({ guideId: "g" }); expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(1);
});
test("negativa fresca avisa uma vez; outra agenda não consulta a obrigação, manual pode consultar", async () => {
  const first = await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt });
  expect(first.avisosEnviados).toBe(1);
  await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt: "2026-09-25T11:00:00Z" });
  expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(1);
  // A outra agenda não pode usar evidência anterior ao seu horário para avisar.
  expect(avisarPagamentoNaoConfirmado).toHaveBeenCalledTimes(1);
  expect(avisarPagamentoNaoConfirmado).toHaveBeenCalledWith(expect.objectContaining({ resultadoConsulta: expect.objectContaining({ consultaId: "consulta", observacaoId: "observacao" }) }));
  await confirmarPagamentoGuia({ guideId: "g" });
  expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(2);
});
test.each([null, { dasPago: null }, { dasPago: false }])("índice sem observação conclusiva nunca vira aviso negativo %j", async idx => {
  consultarDasIndexPorCompetencia.mockResolvedValue(idx);
  expect(await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt })).toMatchObject({ errors: 0, indeterminados: 1, cobertura: "PARCIAL" });
  expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled(); expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
test("falha técnica não notifica e pago automático faz somente a consulta de índice", async () => {
  consultarDasIndexPorCompetencia.mockRejectedValueOnce(Error("timeout"));
  await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt });
  expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled();
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: true, numeroDocumento: DOC, resultadoConsulta: evidence("CONFIRMADO") });
  await confirmarPagamentoGuia({ guideId: "g", scheduledAt });
  expect(confirmarPagamento).not.toHaveBeenCalled();
});
test("falha após persistir negativa retoma só aviso, nunca outra consulta fiscal", async () => {
  avisarPagamentoNaoConfirmado.mockRejectedValueOnce(Error("banco do aviso indisponível"));
  expect((await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt })).errors).toBe(1);
  const r = await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt });
  expect(r.avisosEnviados).toBe(1); expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(1);
});

test("marker legado sem observação não consulta nem autoriza aviso", async () => {
  prisma.appSetting.findUnique.mockResolvedValue({ value: { status: "CONFERENCIA_MANUAL" } });
  expect((await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt })).conferenciaManual).toBe(1);
  expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled(); expect(consultarDasIndexPorCompetencia).not.toHaveBeenCalled();
});
test.each([
  { estado: "INDETERMINADO" }, { cobertura: "PARCIAL" }, { identidadeConferida: false }, { fonte: "PAGTOWEB" },
  { numeroDocumento: "07202600000000002" }, { observacaoId: null }, { consultadoEm: "2026-09-24T10:00:00Z" },
  { evidencia: null }, { evidencia: { periodoPgdas: { competencia: "2026-09", cobertura: "COMPLETA", documentos: [
    { numeroDocumento: DOC, dasPago: false }, { numeroDocumento: "07202600000000002", dasPago: true },
  ] } } },
  { evidencia: { periodoPgdas: { competencia: "2026-09", cobertura: "COMPLETA", impedimentoAviso: "DECLARACAO_POSTERIOR_OU_SEM_DATA",
    documentos: [{ numeroDocumento: DOC, dasPago: false }] } } },
])("resultado insuficiente/antigo não dispara fechamento ou aviso %j", async change => {
  registrarConsultaPagamentoGuia.mockImplementation(async ({ guide }) => ({ guia: guide,
    resultadoConsulta: evidence("NAO_LOCALIZADO", { consultaId: "consulta", observacaoId: "observacao", ...change }), aplicada: true }));
  await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt });
  expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled(); expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
test.each([{ baixada: true }, { paymentStatus: "PAID" }, { clienteConfirmouEm: new Date() }, { paymentStatusSource: "CLIENTE" }])("mudança concorrente para pagamento/baixa não avisa %j", async change => {
  registrarConsultaPagamentoGuia.mockImplementation(async ({ guide }) => ({ guia: { ...guide, ...change },
    resultadoConsulta: evidence("NAO_LOCALIZADO", { consultaId: "consulta", observacaoId: "observacao" }), aplicada: true }));
  await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt });
  expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled(); expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
test("observação recusada por documento alterado não avisa nem encerra consulta", async () => {
  registrarConsultaPagamentoGuia.mockImplementation(async ({ guide }) => ({ guia: guide,
    resultadoConsulta: evidence("NAO_LOCALIZADO", { consultaId: "consulta", observacaoId: "observacao" }), aplicada: false, motivoNaoAplicada: "DOCUMENTO_ALTERADO" }));
  await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt });
  expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled(); expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
test("Comprovante não existe (INSS) permanece inconclusivo, sem aviso ou encerramento", async () => {
  const g = await prisma.guide.findUnique(); prisma.guide.findUnique.mockResolvedValue({ ...g, tipo: "INSS" });
  confirmarPagamento.mockResolvedValue({ pago: null, mensagem: "Comprovante não existe.", resultadoConsulta: evidence("INDETERMINADO", { fonte: "PAGTOWEB", cobertura: "PARCIAL", identidadeConferida: false }) });
  expect(await runPaymentConfirmationOnce({ portalClientId: "c", scheduledAt })).toMatchObject({ indeterminados: 1, naoLocalizado: 0 });
  expect(avisarPagamentoNaoConfirmado).not.toHaveBeenCalled(); expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
