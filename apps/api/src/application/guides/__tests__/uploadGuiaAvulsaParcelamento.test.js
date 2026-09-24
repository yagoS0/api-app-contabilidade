jest.mock("../../../infrastructure/db/prisma.js", () => {
  const store = { guide: null, contrato: null, parcela: null };
  const client = {
    portalClient: { findUnique: jest.fn(async () => ({ id: "empresa", cnpj: "12345678000199", razao: "Teste" })) },
    guide: {
      findFirst: jest.fn(async ({ where }) => where.sourceFileId ? null : store.guide ? { ...store.guide, parcelamento: store.contrato, parcela: store.parcela } : null),
      create: jest.fn(async ({ data }) => (store.guide = { id: "guia", updatedAt: new Date(), ...data })),
      updateMany: jest.fn(async ({ data }) => { Object.assign(store.guide, data); return { count: 1 }; }),
    },
    parcelamento: {
      create: jest.fn(async ({ data }) => (store.contrato = { id: "avulso", ...data })),
      findFirst: jest.fn(async () => store.contrato),
    },
    parcela: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }) => (store.parcela = { id: "prestacao", ...data })) },
  };
  client.$transaction = jest.fn(async fn => fn(client));
  return { prisma: client, __store: store };
});
jest.mock("../GuideRuntimeSettings.js", () => ({ getGuideRuntimeSettings: jest.fn(async () => ({ pdfReaderUrl: "mock" })) }));
jest.mock("../GuideParserClient.js", () => ({ GuideParserClient: { create: () => ({ parsePdf: async () => ({ tipo: "SIMPLES", competencia: "2026-09", valor: 100, vencimento: "2026-09-20", cnpj: "12345678000199" }) }) } }));
jest.mock("../../accounting/fechamentoContabil.js", () => ({ isMonthClosed: jest.fn(async () => false) }));
jest.mock("../lerLinhaDigitavelDoPdf.js", () => ({ lerLinhaDigitavelDoPdf: jest.fn(async () => ({})), situacaoDaLinhaDigitavel: jest.fn(() => ({})), NAO_TENTADA: {} }));
jest.mock("../../accounting/GuideToProvisionService.js", () => ({ generateProvisionsFromGuide: jest.fn(async () => ({})) }));
import { uploadGuideForPortalClient } from "../GuideUploadService.js";
import { toGuideResponse } from "../GuideService.js";
import { __store, prisma } from "../../../infrastructure/db/prisma.js";
import { generateProvisionsFromGuide } from "../../accounting/GuideToProvisionService.js";

test("PDF entra já como PARC, sem abertura contábil, e sai com ação de vínculo posterior", async () => {
  generateProvisionsFromGuide.mockImplementation(async () => {
    expect(__store.guide.parcelamentoId).toBe("avulso");
    return { skipped: "linked_to_parcelamento", entries: [] };
  });
  const r = await uploadGuideForPortalClient({ portalClientId: "empresa", fileBuffer: Buffer.from("%PDF-test"), fileName: "parcela.pdf",
    metadata: { isParcelamento: true, parcelamentoTipo: "PARCSN", numeroParcela: 3 } });
  expect(r.guide).toMatchObject({ parcelamentoId: "avulso", numeroParcela: 3 });
  expect(toGuideResponse(r.guide)).toMatchObject({ parcelamentoAvulso: true, parcelamentoTipo: "PARCSN" });
  expect(__store.contrato).toMatchObject({ numParcelas: null, numeroParcelamento: null, principalTotal: null, competenciaInicial: null });
  expect(prisma.parcela.create).toHaveBeenCalledTimes(1);
  expect(__store.parcela).toMatchObject({ numeroParcela: 3, guiaId: "guia", competencia: "2026-09" });
  expect(__store.guide.paymentStatus).not.toBe("PAID");
});
