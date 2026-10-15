jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {
  portalClient: { findUnique: jest.fn(async () => ({ id: "empresa", cnpj: "12345678000199", razao: "Empresa teste" })) },
  guide: {
    findFirst: jest.fn(async () => null),
    create: jest.fn(async ({ data }) => ({ id: "guia", ...data })),
    findUnique: jest.fn(),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
} }));
jest.mock("../GuideRuntimeSettings.js", () => ({ getGuideRuntimeSettings: async () => ({ pdfReaderUrl: "mock" }) }));
jest.mock("../GuideParserClient.js", () => ({ GuideParserClient: { create: jest.fn() } }));
jest.mock("../../accounting/fechamentoContabil.js", () => ({ isMonthClosed: jest.fn() }));
jest.mock("../../accounting/GuideToProvisionService.js", () => ({ generateProvisionsFromGuide: jest.fn(async () => ({})) }));
jest.mock("../lerLinhaDigitavelDoPdf.js", () => ({ lerLinhaDigitavelDoPdf: jest.fn(async () => ({})), situacaoDaLinhaDigitavel: jest.fn(() => ({})), NAO_TENTADA: {} }));
jest.mock("../../accounting/parcelamento/GuiaAvulsaParcelamentoService.js", () => ({ prepararParcelamentoDaGuia: async () => null }));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { GuideParserClient } from "../GuideParserClient.js";
import { uploadGuideForPortalClient } from "../GuideUploadService.js";
import { createOrUpdateGuideFromProcessing, getFriendlyGuideMessage } from "../GuideService.js";
import { isMonthClosed } from "../../accounting/fechamentoContabil.js";
import { generateProvisionsFromGuide } from "../../accounting/GuideToProvisionService.js";

const pdf = Buffer.from("%PDF-documento-de-teste");
const parsed = { cnpj: "12345678000199", tipo: "DARF", competencia: "2026-09", valor: 217.58, vencimento: "2026-10-23", fields: { composicao: [{ codigo: "2172", total: 217.58 }] } };
const upload = () => uploadGuideForPortalClient({ portalClientId: "empresa", fileBuffer: pdf, fileName: "guia.pdf", metadata: { tipo: "DARF", competencia: "2026-09" } });

beforeEach(() => {
  jest.clearAllMocks();
  isMonthClosed.mockResolvedValue(true);
  prisma.guide.findFirst.mockResolvedValue(null);
  GuideParserClient.create.mockReturnValue({ parsePdf: async () => parsed });
});

test("upload na empresa salva PDF e composição no mês fechado sem escrever provisões", async () => {
  const result = await upload();
  expect(result).toMatchObject({ needsMetadata: false, guide: { status: "PROCESSED", portalClientId: "empresa", valor: 217.58, competencia: "2026-09", pdfBytes: pdf, extracted: { composicao: parsed.fields.composicao } } });
  expect(generateProvisionsFromGuide).not.toHaveBeenCalled();
  expect(result.guide.extracted.contabilizacaoPendente).toMatchObject({ motivo: "MES_FECHADO" });
});

test("mês aberto continua gerando as provisões da guia", async () => {
  isMonthClosed.mockResolvedValue(false);
  const result = await upload();
  expect(generateProvisionsFromGuide).toHaveBeenCalledWith({ guideId: "guia" });
  expect(result.guide.extracted).not.toHaveProperty("contabilizacaoPendente");
});

test("reupload em mês fechado preserva confirmação e comprovante sem atualizar contabilidade", async () => {
  const anterior = { id: "guia", portalClientId: "empresa", updatedAt: new Date(), paymentStatus: "PAID", extracted: { comprovante: { origem: "teste" } } };
  prisma.guide.findFirst.mockResolvedValue(anterior);
  prisma.guide.findUnique.mockResolvedValue(anterior);
  await upload();
  const data = prisma.guide.updateMany.mock.calls[0][0].data;
  expect(data.pdfBytes).toEqual(pdf);
  expect(data).not.toHaveProperty("paymentStatus");
  expect(data.extracted.comprovante).toEqual(anterior.extracted.comprovante);
  expect(generateProvisionsFromGuide).not.toHaveBeenCalled();
});

test("CNPJ divergente continua recusado antes de salvar", async () => {
  GuideParserClient.create.mockReturnValue({ parsePdf: async () => ({ ...parsed, cnpj: "99999999000199" }) });
  await expect(upload()).rejects.toMatchObject({ code: "GUIDE_CNPJ_MISMATCH" });
  expect(prisma.guide.create).not.toHaveBeenCalled();
});

test("reupload após reabrir conserva pendência para contabilização explícita", async () => {
  isMonthClosed.mockResolvedValue(false);
  const anterior = { id: "guia", portalClientId: "empresa", status: "PROCESSED", updatedAt: new Date(), extracted: { contabilizacaoPendente: { motivo: "MES_FECHADO" } } };
  prisma.guide.findFirst.mockResolvedValue(anterior);
  prisma.guide.findUnique.mockResolvedValue(anterior);
  await upload();
  expect(prisma.guide.updateMany.mock.calls[0][0].data.extracted.contabilizacaoPendente).toEqual(anterior.extracted.contabilizacaoPendente);
  expect(generateProvisionsFromGuide).not.toHaveBeenCalled();
});

test("falha do leitor não impede guardar a guia com dados informados, mesmo no mês fechado", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  GuideParserClient.create.mockReturnValue({ parsePdf: async () => { throw Object.assign(new Error("indisponível"), { code: "PDF_READER_HTTP_ERROR" }); } });
  try {
    const result = await upload();
    expect(result).toMatchObject({ needsMetadata: false, guide: { pdfBytes: pdf, status: "PROCESSED", extracted: { parserError: { code: "PDF_READER_HTTP_ERROR" } } } });
    expect(generateProvisionsFromGuide).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("operação sem PDF continua protegida pelo fechamento", async () => {
  await expect(createOrUpdateGuideFromProcessing({ portalClientId: "empresa", source: "UPLOAD", parsed })).rejects.toMatchObject({ code: "MES_FECHADO" });
  expect(prisma.guide.create).not.toHaveBeenCalled();
});

test("mensagens não atribuem falha contábil ou técnica à identificação do documento", () => {
  expect(getFriendlyGuideMessage({ code: "MES_FECHADO" })).toMatch(/período contábil fechado/);
  expect(getFriendlyGuideMessage({ code: "GUIDE_CNPJ_MISMATCH" })).toMatch(/CNPJ/);
  expect(getFriendlyGuideMessage({ code: "P2002" })).toMatch(/salvar/);
  expect(getFriendlyGuideMessage({ code: "P2002" })).not.toMatch(/identificar/);
});
