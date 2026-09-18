import { createMockApi } from "../mockApi";
import { estadoDaGuia, ESTADO_GUIA } from "../../../features/accounting/circular/lib/estadoGuia";

const api = createMockApi();

it("recálculo DAS aparece nas duas consultas contábeis sem alterar partidas nem marcar outros lançamentos", async () => {
  const [empresa, outra] = await api.listCompanies("2026-08");
  const companyId = empresa.companyId;
  const guiaId = `mock-recalculo-${companyId}-SIMPLES`;
  const antes = await api.getAccountingEntries(companyId, { limit: 200 });
  const provisao = antes.data.find((e) => e.sourceGuideId === guiaId);
  expect(provisao).toBeDefined();
  expect(empresa.legacyCompany.regimeTributario).toBe("SIMPLES");
  expect(provisao.subtipo).toBe("DAS");
  expect(estadoDaGuia(provisao, new Date("2026-09-18T12:00:00Z"))).toBe(ESTADO_GUIA.VENCIDA);
  expect(provisao.recalculoGuia).toBeUndefined();
  const original = JSON.parse(JSON.stringify(provisao));
  const resultado = await api.recalculateGuide(guiaId);
  expect(resultado.result.guide).toMatchObject({ vencida: false, vencimentoEstimado: false, paymentStatus: "OPEN" });
  expect(resultado.result.guide.avisoDeRecalculo.vencida).toBe(false);
  const depois = await api.getAccountingEntries(companyId, { competencia: "2025-12" });
  const atual = depois.data.find((e) => e.id === original.id);
  expect(atual.recalculoGuia).toMatchObject({
    guiaId, valorAnterior: 2382.5, valorAtual: resultado.result.guide.valor,
    escopoValor: "TOTAL_GUIA", especie: "DAS",
  });
  expect(atual.valor).toBe(original.valor);
  expect(atual.lines).toEqual(original.lines);
  expect(atual.statusPagamento).toBe("ABERTO");
  expect(atual.sourceGuide.vencimento).toBe(resultado.result.guide.vencimento);
  expect(estadoDaGuia(atual)).toBe(ESTADO_GUIA.A_VENCER);
  const circular = await api.getCircular(companyId, { year: 2025 });
  expect(circular.provisoes.find((e) => e.id === original.id).recalculoGuia).toEqual(atual.recalculoGuia);
  const todas = await api.getAccountingEntries(companyId, { limit: 200 });
  expect(todas.data.filter((e) => e.recalculoGuia).map((e) => e.id)).toEqual([original.id]);
  const outras = await api.getAccountingEntries(outra.companyId);
  expect(outras.data.some((e) => e.recalculoGuia)).toBe(false);
}, 10000);

it("atualizar INSS preserva circular e lançamentos e registra somente o vínculo confirmado", async () => {
  const [empresa] = await api.listCompanies("2026-08");
  const companyId = empresa.companyId;
  await api.updateCircular(companyId, "2026-02", { receitaBruta: 10000, dasTotal: 600, inssTotal: 178.31 });
  const antes = await api.getCircularAccountingEntries(companyId, "2026-02");
  const original = JSON.parse(JSON.stringify(antes));
  const atualizado = await api.syncSerproInss(companyId, { competencia: "2026-02", atualizar: true });
  expect(atualizado.result.guide).toMatchObject({ vencida: false, vencimentoEstimado: false, paymentStatus: "OPEN" });
  const depois = await api.getCircularAccountingEntries(companyId, "2026-02");
  expect(depois.circular).toEqual(original.circular);
  expect(depois.entries).toHaveLength(original.entries.length);
  for (const anterior of original.entries) {
    const atual = depois.entries.find((e) => e.id === anterior.id);
    expect(atual.lines).toEqual(anterior.lines);
    expect(atual.valor).toEqual(anterior.valor);
    expect(Boolean(atual.recalculoGuia)).toBe(anterior.sourceGuideId === `mock-recalculo-${companyId}-INSS`);
  }
  const circular = await api.getCircular(companyId, { year: 2026 });
  expect(circular.provisoes.find((e) => e.sourceGuideId === `mock-recalculo-${companyId}-INSS`).recalculoGuia)
    .toMatchObject({ especie: "INSS", valorAnterior: 178.31, valorAtual: 187.23, escopoValor: "TOTAL_GUIA" });
}, 10000);
