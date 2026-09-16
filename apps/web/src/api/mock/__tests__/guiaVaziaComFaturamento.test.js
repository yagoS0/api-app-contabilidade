import { createMockApi } from "../mockApi";

const api = createMockApi();

it("marca guia sem movimento com faturamento e preserva empresa, tipo e competência", async () => {
  const empresas = await api.listCompanies("2026-08");
  const empresa = empresas.find((e) => e.guideCompliance.das.state === "missing");
  expect(empresa).toBeDefined();
  const fechamento = await api.getFechamentoContabil(empresa.companyId, "2026-08");
  expect(fechamento.faturamentoEmit).toBeGreaterThan(0);
  expect(await api.markGuideVazio(empresa.companyId, "SIMPLES", "2026-08")).toMatchObject({ ok: true, status: "VAZIO" });
  const depois = await api.listCompanies("2026-08");
  expect(depois.find((e) => e.companyId === empresa.companyId).guideCompliance.das).toMatchObject({
    ok: true, state: "vazio", origem: "guia_vazia", vazioPor: "Usuario Mock",
  });
  const outroMes = await api.listCompanies("2026-06");
  expect(outroMes.find((e) => e.companyId === empresa.companyId).guideCompliance.das.state).toBe("missing");
  await api.undoGuideVazio(empresa.companyId, "SIMPLES", "2026-08");
  const desfeito = await api.listCompanies("2026-08");
  expect(desfeito.find((e) => e.companyId === empresa.companyId).guideCompliance.das.state).toBe("missing");
}, 10000);

it("também atualiza guia faltante na empresa com guias em situações diferentes", async () => {
  const empresas = await api.listCompanies("2026-08");
  const empresa = empresas.find((e) => e.guideCompliance.iss.state === "missing" && e.guideCompliance.irpj.state === "gerada");
  expect(empresa).toBeDefined();
  await api.markGuideVazio(empresa.companyId, "ISS", "2026-08", "Retido pelo tomador");
  const depois = await api.listCompanies("2026-08");
  const compliance = depois.find((e) => e.companyId === empresa.companyId).guideCompliance;
  expect(compliance.iss).toMatchObject({ state: "vazio", ok: true, vazioMotivo: "Retido pelo tomador" });
  expect(compliance.irpj.state).toBe("gerada");
  await api.undoGuideVazio(empresa.companyId, "ISS", "2026-08");
});
