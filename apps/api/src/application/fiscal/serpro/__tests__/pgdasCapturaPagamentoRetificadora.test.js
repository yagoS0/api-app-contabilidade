import { syncPgdasByCompetencia } from "../SerproPgdasDeclaracaoService.js";
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { capturePgdasGuideForCompany } from "../CaptureSerproGuidesService.js";
import { registrarConsultaPagamentoGuia } from "../../../guides/ConsultaPagamentoGuiaService.js";
import { SerproPgdasdService } from "../SerproPgdasdService.js";
import { SerproHttpClient } from "../SerproHttpClient.js";

jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {
  portalClient: { findUnique: jest.fn() }, guide: { findFirst: jest.fn(), findUnique: jest.fn() },
  companyMonthlyCircular: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() }, apuracaoSnapshot: { updateMany: jest.fn(async () => ({ count: 0 })) },
} }));
jest.mock("../SerproPgdasdService.js", () => ({ SerproPgdasdService: jest.fn(), SERPRO_PGDASD_SERVICE_NORMAL: "GERARDAS12" }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn() }));
jest.mock("../CaptureSerproGuidesService.js", () => ({ capturePgdasGuideForCompany: jest.fn() }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "98765432000199" } })) }));
jest.mock("../../../guides/ConsultaPagamentoGuiaService.js", () => ({ registrarConsultaPagamentoGuia: jest.fn(async args => ({ resultadoConsulta: args.resultadoConsulta, aplicada: true })) }));
jest.mock("../../../guides/GuideStorageService.js", () => ({ GuideStorageService: { create: jest.fn(() => ({ upload: jest.fn(async ({ key }) => ({ key, url: "/local/declaracao.pdf" })) })) } }));
jest.mock("../../../accounting/AccountingEntryGeneratorService.js", () => ({ generateEntriesFromCircular: jest.fn(async () => ({ ok: true, generatedEntries: [] })), FONTE_VALOR_EXTRATO: "EXTRATO" }));
jest.mock("../../../accounting/semFaturamento.js", () => ({ marcarSemFaturamento: jest.fn() }));
jest.mock("pdf-parse", () => jest.fn(async () => ({ text: "Receita Bruta Informada: R$ 1.000,00\nPrincipal 100,00 Multa 0,00 Juros 0,00 Total 100,00" })));

const antigo = "07202600000000001";
const novo = "07202600000000002";
const response = { status: 200, dados: JSON.stringify({ periodo: { periodoApuracao: 202608, operacoes: [
  { tipoOperacao: "Geração de DAS", indiceDas: { numeroDas: antigo, dasPago: true, dataHoraEmissaoDas: "20260910120000" } },
  { tipoOperacao: "Retificadora", indiceDeclaracao: { dataHoraTransmissao: "20260921120000", numeroDeclaracao: "00000000202608002" } },
  { tipoOperacao: "Geração de DAS", indiceDas: { numeroDas: novo, dasPago: false, dataHoraEmissaoDas: "20260922120000" } },
] } }) };
const guide = { id: "guia-nova", portalClientId: "empresa", cnpj: "12345678000199", competencia: "08/2026", tipo: "SIMPLES",
  pdfBytes: Buffer.from("%PDF-1.4 sintetico"), extracted: { numeroDocumento: novo }, paymentStatus: "OPEN" };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.portalClient.findUnique.mockResolvedValue({ id: "empresa", cnpj: guide.cnpj });
  prisma.guide.findFirst.mockResolvedValue(null);
  prisma.guide.findUnique.mockResolvedValue(guide);
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue(null);
  prisma.companyMonthlyCircular.upsert.mockResolvedValue({ id: "circular", metadata: {} });
  prisma.companyMonthlyCircular.update.mockImplementation(async ({ data }) => ({ id: "circular", ...data }));
  SerproPgdasdService.mockImplementation(() => ({ consultarDeclaracaoIndice: jest.fn(async () => response) }));
  SerproHttpClient.mockImplementation(() => ({ post: jest.fn(async () => ({ dados: JSON.stringify({ declaracao: { pdf: Buffer.from("pdf-sintetico").toString("base64") } }) })) }));
  capturePgdasGuideForCompany.mockResolvedValue({ guide: { guideId: guide.id } });
});

test("dois DAS não impedem baixar a guia; somente seu número após captura define o pagamento", async () => {
  const r = await syncPgdasByCompetencia({ portalClientId: "empresa", competencia: "2026-08", atualizar: true });
  expect(r.dasIndex).toMatchObject({ temDasNoPeriodo: true, dasPago: null, resultadoConsulta: { estado: "INDETERMINADO" } });
  expect(capturePgdasGuideForCompany).toHaveBeenCalledTimes(1);
  expect(r.guide).toMatchObject({ id: guide.id, extracted: { numeroDocumento: novo } });
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledWith(expect.objectContaining({ guide, resultadoConsulta: expect.objectContaining({
    estado: "NAO_LOCALIZADO", numeroDocumento: novo, identidadeConferida: true,
  }) }));
  expect(registrarConsultaPagamentoGuia.mock.calls[0][0].resultadoConsulta.consultadoEm).toMatch(/^\d{4}-/);
});

test("PDF disponível mas sem número mantém pagamento inconclusivo sem perder o documento", async () => {
  prisma.guide.findUnique.mockResolvedValue({ ...guide, extracted: {} });
  const r = await syncPgdasByCompetencia({ portalClientId: "empresa", competencia: "2026-08", atualizar: true });
  expect(r.guide.pdfBytes.length).toBeGreaterThan(0);
  expect(registrarConsultaPagamentoGuia.mock.calls[0][0].resultadoConsulta.estado).toBe("INDETERMINADO");
});

test("índice recebido sem instante de consulta não vira observação fresca", async () => {
  await syncPgdasByCompetencia({ portalClientId: "empresa", competencia: "2026-08", atualizar: true, indiceExistente: response });
  expect(capturePgdasGuideForCompany).toHaveBeenCalledTimes(1);
  expect(registrarConsultaPagamentoGuia).not.toHaveBeenCalled();
});
