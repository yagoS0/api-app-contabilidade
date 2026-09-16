import { compararRegimes } from "../comparador";
const e = { receitaAnual: 1200000, folhaAnual: 360000, folhaRemuneracoesAnual: 300000, encargosAdicionaisAnuais: 10000, margemLucro: 0.2, creditosPisCofins: 0, atividadePresumido: "servicos", aliquotaIss: 0.05,
  receitasPorAtividade: [{ receita: 600000, atividade: "servicos", anexo: "III", issPct: 5 }, { receita: 600000, atividade: "comercio", anexo: "I" }] };
it("usa RBT12 conjunto, presunções separadas, CPP única e ISS só nos serviços", () => {
  const r = compararRegimes(e); const lp = r.regimes.find(x => x.regime === "Lucro Presumido");
  expect(lp.porTributo.irpj).toBe(36000); expect(lp.porTributo.csll).toBe(23760);
  expect(lp.porTributo.adicionalIrpj).toBe(0); expect(lp.porTributo.iss).toBe(30000);
  expect(lp.porTributo.cpp).toBe(60000); expect(lp.porTributo.encargos).toBe(10000);
  const sn = r.regimes.find(x => x.regime === "Simples Nacional");
  expect(sn.atividades[0].total).toBeCloseTo(78180, 2); // III na faixa da empresa, não da atividade.
  expect(r.vencedor).toBeNull(); expect(lp.cobertura.pendencias.join(" ")).toMatch(/ICMS/);
});
it("adicional soma bases antes de aplicar o limite por empresa", () => {
  const r = compararRegimes({ ...e, receitasPorAtividade: e.receitasPorAtividade.map(l => ({ ...l, atividade: "servicos", anexo: "III", issPct: 5 })) });
  expect(r.regimes.find(x => x.regime === "Lucro Presumido").porTributo.adicionalIrpj).toBe(14400);
});
it("segregação incompleta não produz total plausível", () => {
  const r = compararRegimes({ ...e, receitasPorAtividade: e.receitasPorAtividade.slice(0, 1) });
  expect(r.regimes.every(x => x.indisponivel)).toBe(true); expect(r.vencedor).toBeNull();
});
