import { contabilizarDasCapturado } from "../../public.js";

function fixture() {
  const input = {
    portalClient: { id: "portal-443", cnpj: "12345678000199" },
    normalizedCompetencia: "2026-10",
    mapped: { parsed: { valor: 115 }, pdfBuffer: Buffer.from("synthetic"), numeroDocumento: "443" },
    resolvedServiceId: "GERARDAS12",
    procuradorCnpj: "98765432000198",
    now: new Date("2026-11-14T12:00:00Z"),
    somenteDocumentos: false,
  };
  const trace = [];
  const circular = { id: "circular-443", acrescimos: null };
  const accounting = { ok: true, generatedEntries: [], circular: { ...circular, acrescimos: { DAS: {} } } };
  const record = (name, result) => jest.fn(async () => { trace.push(name); return result; });
  const ports = {
    lerCircularDasCapturado: record("read", circular),
    gravarCircularDasCapturado: record("circular", circular),
    lerComposicaoDas: record("composition", { totais: { total: 115, principal: 100, juros: 10, multa: 5 } }),
    gravarAcrescimosDasCapturado: record("split", undefined),
    gerarLancamentosDasCapturado: record("entries", accounting),
  };
  return { input, trace, circular, accounting, ports };
}

test("preserves sequence, identities, now and the original circular rather than the generator reread", async () => {
  const { input, ports, trace, circular, accounting } = fixture();
  const result = await contabilizarDasCapturado(input, ports);
  expect(trace).toEqual(["circular", "composition", "split", "entries"]);
  expect(result.circular).toBe(circular);
  expect(result.accounting).toBe(accounting);
  expect(result.accounting.generatedEntries).toEqual([]);
  expect(ports.gravarCircularDasCapturado).toHaveBeenCalledWith({
    portalClient: input.portalClient, normalizedCompetencia: input.normalizedCompetencia,
    mapped: input.mapped, resolvedServiceId: input.resolvedServiceId,
    procuradorCnpj: input.procuradorCnpj, now: input.now,
  });
  expect(ports.lerComposicaoDas).toHaveBeenCalledWith(input.mapped.pdfBuffer);
  expect(ports.gravarAcrescimosDasCapturado).toHaveBeenCalledWith({
    portalClientId: "portal-443", competencia: "2026-10",
    valores: { DAS: { principal: 100, juros: 10, multa: 5 } },
  });
  expect(ports.gerarLancamentosDasCapturado).toHaveBeenCalledWith({
    portalClientId: "portal-443", competencia: "2026-10", now: input.now,
  });
  expect(ports.gerarLancamentosDasCapturado.mock.calls[0][0].now).toBe(input.now);
});

test.each([null, { id: "closed", fechadoContabilEm: new Date() }])("document-only returns existing circular %j without writes", async circular => {
  const { input, ports, trace } = fixture();
  ports.lerCircularDasCapturado.mockResolvedValue(circular);
  expect(await contabilizarDasCapturado({ ...input, somenteDocumentos: true }, ports)).toEqual({
    circular, accounting: { skipped: true, somenteDocumentos: true },
  });
  expect(ports.lerCircularDasCapturado).toHaveBeenCalledWith({ portalClientId: "portal-443", competencia: "2026-10" });
  expect(trace).toEqual([]);
  expect(ports.gravarCircularDasCapturado).not.toHaveBeenCalled();
  expect(ports.lerComposicaoDas).not.toHaveBeenCalled();
  expect(ports.gravarAcrescimosDasCapturado).not.toHaveBeenCalled();
  expect(ports.gerarLancamentosDasCapturado).not.toHaveBeenCalled();
});

test.each([false, true])("circular failure propagates unchanged (document-only=%s)", async somenteDocumentos => {
  const { input, ports, trace } = fixture();
  const failure = Object.assign(new Error("conflict"), { code: "P2002" });
  ports[somenteDocumentos ? "lerCircularDasCapturado" : "gravarCircularDasCapturado"].mockRejectedValue(failure);
  await expect(contabilizarDasCapturado({ ...input, somenteDocumentos }, ports)).rejects.toBe(failure);
  expect(trace).toEqual([]);
});

test.each(["lerComposicaoDas", "gravarAcrescimosDasCapturado"])("%s failure is best effort and never retried", async port => {
  const { input, ports, accounting } = fixture();
  ports[port].mockRejectedValue(new Error("unavailable"));
  expect((await contabilizarDasCapturado(input, ports)).accounting).toBe(accounting);
  expect(ports[port]).toHaveBeenCalledTimes(1);
  expect(ports.gerarLancamentosDasCapturado).toHaveBeenCalledTimes(1);
});

test.each([null, { totais: { total: 200 } }])("unknown or mismatched composition %j does not write split", async composition => {
  const { input, ports } = fixture();
  ports.lerComposicaoDas.mockResolvedValue(composition);
  await contabilizarDasCapturado(input, ports);
  expect(ports.gravarAcrescimosDasCapturado).not.toHaveBeenCalled();
  expect(ports.gerarLancamentosDasCapturado).toHaveBeenCalledTimes(1);
});

test.each([null, Object.assign(new Error("closed"), { code: "MES_FECHADO" })])("generator rejection %j returns the legacy partial error", async error => {
  const { input, ports, circular } = fixture();
  ports.gerarLancamentosDasCapturado.mockRejectedValue(error);
  expect(await contabilizarDasCapturado(input, ports)).toEqual({ circular, accounting: {
    ok: false, error: error?.code || "ACCOUNTING_GENERATION_FAILED",
    reason: error?.message || "Falha ao gerar lançamentos a partir da Circular.",
  } });
  expect(ports.gerarLancamentosDasCapturado).toHaveBeenCalledTimes(1);
});

test("partial return from the generator is not reinterpreted as success", async () => {
  const { input, ports } = fixture();
  const partial = { ok: false, reason: "mes_fechado", generatedEntries: [] };
  ports.gerarLancamentosDasCapturado.mockResolvedValue(partial);
  expect((await contabilizarDasCapturado(input, ports)).accounting).toBe(partial);
});
