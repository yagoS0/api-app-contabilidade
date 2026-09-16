import { projetarTransicao } from "../transicaoReforma";
it("sem parâmetros não inventa alíquota futura ou imposto zero", () => {
  expect(projetarTransicao().every(t => t.incompleta && t.total == null)).toBe(true);
});
it("respeita transição do ISS e não cruza créditos de IBS e CBS", () => {
  const base = { receita: 1000000, cbsPct: 9, ibsPct: 8, creditosCbs: 100000, creditosIbs: 0, issAtual: 50000 };
  const r = projetarTransicao({ 2027: base, 2029: base, 2033: base });
  expect(r[0].ibs).toBe(1000); expect(r[0].cbs).toBe(0); expect(r[0].creditoExcedenteCbs).toBe(10000);
  expect(r[2].iss).toBe(45000); expect(r[2].ibs).toBe(80000);
  expect(r[6].iss).toBe(0); expect(r[6].total).toBe(80000);
});
