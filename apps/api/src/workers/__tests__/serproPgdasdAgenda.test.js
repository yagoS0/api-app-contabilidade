jest.mock("../../config.js", () => ({ log: {}, INTEGRACAO_SERPRO_PARCELAMENTO: true }));
jest.mock("../../infrastructure/db/prisma.js", () => ({ prisma: { portalClient: { findMany: jest.fn() }, company: { findMany: jest.fn() }, guide: { findFirst: jest.fn() }, parcelamento: { findMany: jest.fn() }, companyMonthlyCircular: { findUnique: jest.fn() } } }));
jest.mock("../../application/guides/GuideLockService.js", () => ({ acquireGuideLease: jest.fn(async () => ({ assertActive() {}, release: jest.fn() })) }));
jest.mock("../../application/guides/GuideScheduledEmailService.js", () => ({ resolveCompanyNotificationEmail: jest.fn(async () => null) }));
jest.mock("../../application/fiscal/serpro/SerproRuntimeSettings.js", () => ({ getSerproRuntimeSettings: jest.fn(async () => ({ enabled: true, rotinas: { das: { enabled: true }, extrato: { enabled: true }, parcelamento: { enabled: true } } })) }));
jest.mock("../../application/fiscal/serpro/SerproProcurationService.js", () => ({ SerproProcurationService: jest.fn(() => ({ checkCompanyProcuration: jest.fn(async () => ({ status: "ATIVA" })) })) }));
jest.mock("../../application/fiscal/serpro/CaptureSerproGuidesService.js", () => ({ capturePgdasGuideForCompany: jest.fn(async () => ({ guide: { guideId: "das" } })) }));
jest.mock("../../application/fiscal/lp/LucroPresumidoProvisaoService.js", () => ({ capturarLpDaCompetencia: jest.fn() }));
jest.mock("../../application/fiscal/serpro/SerproPgdasDeclaracaoService.js", () => ({ syncPgdasByCompetencia: jest.fn() }));
jest.mock("../../application/fiscal/serpro/CaptureSerproParcelaService.js", () => ({ capturarParcelaGuideForCompany: jest.fn(async () => ({ ok: true, parcelas: [] })) }));
jest.mock("../../application/fiscal/serpro/ParcelamentoDescobertaService.js", () => ({ prepararAcompanhamentoParcelamentosEmpresa: jest.fn(async () => ({ ok: true, resultados: [] })) }));
jest.mock("../../application/fiscal/serpro/SerproExecutionLogService.js", () => ({ createSerproExecutionLog: jest.fn() }));
jest.mock("../../application/fiscal/serpro/CompanyRotinasService.js", () => ({ idsComRotinaAtiva: jest.fn(async () => new Set(["empresa"])) }));
jest.mock("../runRoutineLoop.js", () => ({ runRoutineLoop: jest.fn() }));

import { prisma } from "../../infrastructure/db/prisma.js";
import { capturePgdasGuideForCompany } from "../../application/fiscal/serpro/CaptureSerproGuidesService.js";
import { syncPgdasByCompetencia } from "../../application/fiscal/serpro/SerproPgdasDeclaracaoService.js";
import { prepararAcompanhamentoParcelamentosEmpresa } from "../../application/fiscal/serpro/ParcelamentoDescobertaService.js";
import { capturarParcelaGuideForCompany } from "../../application/fiscal/serpro/CaptureSerproParcelaService.js";
import { runSerproPgdasdWorkerOnce } from "../serproPgdasdWorker.js";

beforeEach(() => {
  jest.clearAllMocks();
  prisma.portalClient.findMany.mockResolvedValue([{ id: "empresa", cnpj: "12345678000100", companyId: "legacy" }]);
  prisma.company.findMany.mockResolvedValue([{ id: "legacy", regimeTributario: "SIMPLES" }]);
  prisma.guide.findFirst.mockResolvedValue(null);
  prisma.parcelamento.findMany.mockResolvedValue([{ id: "acordo", numeroParcelamento: "1", aberturaEntryId: null }]);
  prepararAcompanhamentoParcelamentosEmpresa.mockResolvedValue({ ok: true, resultados: [] });
  capturarParcelaGuideForCompany.mockResolvedValue({ ok: true, parcelas: [] });
});

test("horário DAS não executa outras rotinas e não exige e-mail", async () => {
  const result = await runSerproPgdasdWorkerOnce({ routines: ["das"], competencia: "2026-08" });
  expect(result.captured).toBe(1);
  expect(syncPgdasByCompetencia).not.toHaveBeenCalled();
  expect(prepararAcompanhamentoParcelamentosEmpresa).not.toHaveBeenCalled();
  expect(prisma.guide.findFirst.mock.calls[0][0].where).toMatchObject({ parcelamentoId: null, NOT: { sourceFileId: { startsWith: "PARC-" } } });
});

test("contrato antigo acompanha sem abertura contábil e mesmo fora do Simples", async () => {
  prisma.company.findMany.mockResolvedValue([{ id: "legacy", regimeTributario: "LUCRO_PRESUMIDO" }]);
  await runSerproPgdasdWorkerOnce({ routines: ["parcelamento"] });
  expect(capturarParcelaGuideForCompany).toHaveBeenCalledTimes(1);
  expect(capturePgdasGuideForCompany).not.toHaveBeenCalled();
  const where = prisma.parcelamento.findMany.mock.calls[0][0].where;
  expect(where.aberturaEntryId).toBeUndefined();
  expect(where.OR).toContainEqual({ fiscalSituacao: null });
});

test("falha de localização persiste no resumo da agenda", async () => {
  prepararAcompanhamentoParcelamentosEmpresa.mockResolvedValue({ ok: false, resultados: [{ ok: false, reason: "Procuração insuficiente" }] });
  const result = await runSerproPgdasdWorkerOnce({ routines: ["parcelamento"] });
  expect(result.parcelasErro).toBe(1);
  expect(result.parcelaResults[0].reason).toBe("Procuração insuficiente");
});

test("captura indisponível não equivale a nenhuma parcela devida", async () => {
  capturarParcelaGuideForCompany.mockResolvedValue({ ok: false, reason: "modalidade_nao_suportada", parcelas: [] });
  const result = await runSerproPgdasdWorkerOnce({ routines: ["parcelamento"] });
  expect(result.parcelasErro).toBe(1);
});
