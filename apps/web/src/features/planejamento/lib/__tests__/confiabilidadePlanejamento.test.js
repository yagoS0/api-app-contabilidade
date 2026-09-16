import { compararRegimes } from "../comparador";
import { custoMensalDoSocio, irrfMensal, simularProLaboreParaFatorR, RECUSA } from "../proLabore";
const base = { receitaAnual: 1200000, folhaAnual: 100000, folhaRemuneracoesAnual: 80000, encargosAdicionaisAnuais: 0, anexoSimples: "III", atividadePresumido: "servicos", aliquotaIss: 0.05, margemLucro: 0.2, creditosPisCofins: 0, regimeAtual: "LUCRO_PRESUMIDO" };
it.each([{ folhaAnual: null, folhaRemuneracoesAnual: null }, { folhaRemuneracoesAnual: null }, { encargosAdicionaisAnuais: null }, { atividadePresumido: "comercio" }, { aliquotaIss: null }, { margemLucro: null }])("não recomenda estimativa incompleta %j", faltando => {
  const r = compararRegimes({ ...base, ...faltando });
  expect(r.menorEstimativa).not.toBeNull(); expect(r.vencedor).toBeNull(); expect(r.economiaAnual).toBeNull(); expect(r.economiaVsAtual).toBeNull();
});
it("CPP usa remuneração e economia usa o regime atual", () => {
  const r = compararRegimes(base);
  const lp = r.regimes.find(x => x.regime === "Lucro Presumido");
  expect(lp.porTributo.cpp).toBe(16000); expect(r.comparacaoCompleta).toBe(true);
  expect(r.economiaVsAtual).toBeCloseTo(lp.total - r.vencedor.total, 5);
  expect(compararRegimes({ ...base, regimeAtual: "LUCRO_REAL" }).economiaVsAtual).not.toBe(r.economiaVsAtual);
});
it("exemplo RFB: bruto 6.000 e deduções legais 649,60 dão IRRF 382,88", () => {
  expect(irrfMensal(6000, 649.60)).toBeCloseTo(382.88, 2);
  expect(custoMensalDoSocio(6000).irrf).toBeCloseTo(380.02, 2);
});
it("não converte folha total em pró-labore", () => {
  const r = simularProLaboreParaFatorR({ rbt12: 1200000, folha12mAtual: 200000 });
  expect(r.recusa).toBe(RECUSA.SEM_PROLABORE); expect(r.proLaboreHoje).toBeUndefined();
});
it("apura cada sócio e distribui o aumento igualmente", () => {
  const r = simularProLaboreParaFatorR({ rbt12: 1200000, folha12mAtual: 200000, economiaNoDas: 50000, socios: [{ nome: "A", proLaboreMensal: 2000 }, { nome: "B", proLaboreMensal: 6000 }] });
  expect(r.proLaboreHoje).toBe(8000); expect(r.porSocio).toHaveLength(2);
  expect(r.porSocio[0].depois.proLabore - r.porSocio[0].hoje.proLabore).toBeCloseTo(136000 / 24, 5);
  expect(r.hoje.irrf).toBeCloseTo(380.02, 2);
});
