import { custoAnualReal } from "../comparador";
const valores = { ativo: true, custos: 300000, despesas: 500000, outrasReceitas: 0, adicoesIrpj: 20000, exclusoesIrpj: 10000, adicoesCsll: 5000, exclusoesCsll: 0 };
const base = { receitaAnual: 1200000, creditosPisCofins: 0, aliquotaIss: 0.05, folhaAnual: 0, lucroRealDetalhado: valores };
it("reconstrói bases diferentes de IRPJ e CSLL, preservando memória", () => {
  const r = custoAnualReal(base);
  expect(r.basesDetalhadas.lucroContabil).toBe(400000);
  expect(r.porTributo.irpj).toBe(61500);
  expect(r.porTributo.csll).toBe(36450);
  expect(r.porTributo.adicionalIrpj).toBe(17000);
});
it("prejuízo não gera imposto negativo e ausência não vira despesa zero", () => {
  expect(custoAnualReal({ ...base, lucroRealDetalhado: { ...valores, custos: 1500000 } }).porTributo.irpj).toBe(0);
  expect(custoAnualReal({ ...base, lucroRealDetalhado: { ...valores, despesas: "" } }).indisponivel).toBe(true);
});
it("desativar detalhe preserva simulação por margem", () => {
  const r = custoAnualReal({ ...base, margemLucro: 0.2, lucroRealDetalhado: { ...valores, ativo: false } });
  expect(r.porTributo.irpj).toBe(36000);
});
