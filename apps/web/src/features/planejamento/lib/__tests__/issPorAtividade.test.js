import { compararRegimes, custoAnualReal } from "../comparador";
import { custoAnualPresumido } from "../lucroPresumido";
import { custoAnualSimples } from "../simplesNacional";
import { montarComparativo, celulaDoTributo, AUSENCIA } from "../comparativoDeRegimes";

const base = { receitaAnual: 1_200_000, aliquotaIss: 0.05, folhaAnual: 0, margemLucro: 0.2, creditosPisCofins: 0 };

it.each([1_200_000, 4_000_000])("Anexo IV: tributos detalhados fecham o total, incluindo encargos por fora (receita %s)", receita => {
  const r = custoAnualSimples({ anexoChave: "IV", receitaAnual: receita, rbt12: receita, folhaAnual: 36000, aliquotaIss: 0.05 });
  expect(r.porTributo.cpp).toBe(7200);
  expect(r.memoriaPorTributo.cpp).toMatchObject({ aliquota: 0.2, baseCalculo: 36000 });
  expect(Object.values(r.porTributo).reduce((s, v) => s + v, 0)).toBeCloseTo(r.total, 4);
  for (const [tributo, valor] of Object.entries(r.porTributo)) {
    const m = r.memoriaPorTributo[tributo];
    expect(m.aliquota * m.baseCalculo).toBeCloseTo(valor, 4);
  }
});

it.each(["comercio", "combustiveis"])("%s não recebe ISS sobre receita de mercadorias", atividade => {
  for (const calcular of [custoAnualPresumido, custoAnualReal]) {
    const comIss = calcular({ ...base, atividade });
    const semIss = calcular({ ...base, atividade, aliquotaIss: null });
    expect(comIss.total).toBeCloseTo(semIss.total, 2);
    expect(comIss.porTributo).not.toHaveProperty("iss");
    expect(semIss.naoConsiderado.join(" ")).not.toMatch(/ISS \(/);
  }
});

it("atividade chega aos dois regimes e a tabela distingue não aplicável de não estimado", () => {
  const entradas = { ...base, atividadePresumido: "comercio", anexoSimples: "III" };
  const comparativo = montarComparativo(compararRegimes(entradas), entradas);
  for (const chave of ["presumido", "real"]) {
    expect(celulaDoTributo(comparativo.colunas.find(c => c.chave === chave), "iss"))
      .toEqual({ valor: null, ausencia: AUSENCIA.NAO_SE_APLICA });
  }
});

it("serviços preservam ISS de 5% e total anual com adicional de IRPJ", () => {
  const r = custoAnualPresumido({ ...base, atividade: "servicos" });
  expect(r.porTributo).toMatchObject({ irpj: 57600, adicionalIrpj: 14400, csll: 34560, pis: 7800, cofins: 36000, iss: 60000 });
  expect(r.total).toBeCloseTo(210360, 2);
  expect(r.cargaEfetiva).toBeCloseTo(0.1753, 6);
});

it("ISS desconhecido em serviços não vira não incidência, inclusive no Real", () => {
  const r = custoAnualReal({ ...base, atividade: "servicos", aliquotaIss: null });
  expect(r.porTributo).not.toHaveProperty("iss");
  expect(celulaDoTributo(r, "iss").ausencia).toBe(AUSENCIA.NAO_ESTIMADO);
});

it("Lente: 17,88% inclui adicional de IRPJ e CPP, além dos tributos sobre serviços", () => {
  const r = custoAnualPresumido({ receitaAnual: 1017686.09, folhaAnual: 36000, atividade: "servicos", aliquotaIss: 0.05 });
  expect(r.total).toBeCloseTo(181954.093377, 6);
  expect(r.cargaEfetiva * 100).toBeCloseTo(17.87919626345684, 8);
  expect(r.porTributo.adicionalIrpj).toBeCloseTo(8565.95488, 6);
  expect(r.porTributo.cpp).toBe(7200);
  expect(Object.values(r.porTributo).reduce((total, v) => total + v, 0)).toBeCloseTo(r.total, 6);
});
