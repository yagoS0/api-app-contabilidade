import { persistirDocumentoDas } from "../persistirDocumentoDas.js";

function preparar(existingGuide = null) {
  const input = {
    existingGuideId: null,
    portalClient: { id: "portal-a", companyId: "company-a", cnpj: "00000000000191" },
    mapped: {
      parsed: { tipo: "SIMPLES", competencia: "2026-10", valor: 123.45, valorOriginal: 100 },
      pdfBuffer: Buffer.from("%PDF-sintetico"),
      numeroDocumento: "123",
      rawPayload: { dados: "resposta sintetica" },
    },
    sourceFileId: "serpro:pgdasd:GERARDAS12:00000000000191:2026-10:123",
    labels: { sourcePath: "SERPRO PGDAS-D", checkResult: "FOUND_NORMAL" },
    normalizedCompetencia: "2026-10",
    emailStatusOverride: "PRESERVE",
    resolvedServiceId: "GERARDAS12",
    procuradorCnpj: "00000000000272",
  };
  const calls = [];
  const now = new Date("2026-11-14T12:00:00Z");
  const guide = { id: "guide-result" };
  const ports = {
    lerGuiaPorSourceFileId: jest.fn(async () => { calls.push("lookup"); return existingGuide; }),
    clock: jest.fn(() => { calls.push("clock"); return now; }),
    hashPdf: jest.fn(() => { calls.push("hash"); return "hash-pdf"; }),
    createOrUpdateGuideFromProcessing: jest.fn(async () => { calls.push("writer"); return guide; }),
  };
  return { input, ports, calls, now, guide };
}

test("encaminha o contrato documental exato e conserva referencias e ordem", async () => {
  const { input, ports, calls, now, guide } = preparar();
  const result = await persistirDocumentoDas(input, ports);
  expect(calls).toEqual(["lookup", "clock", "hash", "writer"]);
  expect(ports.lerGuiaPorSourceFileId).toHaveBeenCalledWith(input.sourceFileId);
  expect(ports.hashPdf).toHaveBeenCalledWith(input.mapped.pdfBuffer);
  expect(ports.createOrUpdateGuideFromProcessing).toHaveBeenCalledTimes(1);
  const payload = ports.createOrUpdateGuideFromProcessing.mock.calls[0][0];
  expect(payload).toStrictEqual({
    existingGuideId: null,
    portalClientId: "portal-a",
    legacyCompanyId: "company-a",
    parsed: input.mapped.parsed,
    source: "SERPRO",
    sourceFileId: input.sourceFileId,
    sourcePath: "SERPRO PGDAS-D 2026-10",
    driveInboxFolderId: null,
    driveFinalFolderId: null,
    driveFinalFileId: null,
    pdfBytes: input.mapped.pdfBuffer,
    hash: "hash-pdf",
    status: "PROCESSED",
    errors: [],
    paymentStatus: "OPEN",
    emailStatusOverride: "PRESERVE",
    serproLastCheckedAt: now,
    serproLastCheckResult: "FOUND_NORMAL",
    serproLastSeenAt: now,
    serproService: "GERARDAS12",
    extracted: {
      integrationSource: "SERPRO_PGDASD",
      sistema: "PGDASD",
      servico: "GERARDAS12",
      numeroDocumento: "123",
      contratanteCnpj: "00000000000272",
      contribuinteCnpj: "00000000000191",
      referencia: "2026-10",
      rawPayload: input.mapped.rawPayload,
    },
  });
  expect(payload.parsed).toBe(input.mapped.parsed);
  expect(payload.pdfBytes).toBe(input.mapped.pdfBuffer);
  expect(payload.extracted.rawPayload).toBe(input.mapped.rawPayload);
  expect(payload.serproLastCheckedAt).toBe(now);
  expect(payload.serproLastSeenAt).toBe(now);
  expect(result.guide).toBe(guide);
  expect(result.now).toBe(now);
});

test.each([null, "guide-explicit"])("preserva pagamento da leitura com ID explicito %s", async (existingGuideId) => {
  const paymentConfirmedAt = new Date("2026-11-10T12:00:00Z");
  const { input, ports } = preparar({ id: "guide-found", paymentStatus: "PAID", paymentStatusSource: "CLIENTE", paymentConfirmedAt });
  input.existingGuideId = existingGuideId;
  input.portalClient.companyId = null;
  input.emailStatusOverride = undefined;
  await persistirDocumentoDas(input, ports);
  expect(ports.createOrUpdateGuideFromProcessing.mock.calls[0][0]).toMatchObject({
    existingGuideId: existingGuideId || "guide-found",
    legacyCompanyId: null,
    paymentStatus: "PAID",
    paymentStatusSource: "CLIENTE",
    paymentConfirmedAt,
    emailStatusOverride: undefined,
  });
});

test.each([
  ["lerGuiaPorSourceFileId", []],
  ["clock", ["lookup"]],
  ["hashPdf", ["lookup", "clock"]],
  ["createOrUpdateGuideFromProcessing", ["lookup", "clock", "hash"]],
])("propaga falha de %s sem repetir ou executar etapas posteriores", async (port, completed) => {
  const { input, ports, calls } = preparar();
  const error = new Error("falha sintetica");
  ports[port].mockImplementation(() => { throw error; });
  await expect(persistirDocumentoDas(input, ports)).rejects.toBe(error);
  expect(calls).toEqual(completed);
  expect(ports[port]).toHaveBeenCalledTimes(1);
});
