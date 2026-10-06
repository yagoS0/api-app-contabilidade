import { planejarClassificacaoCircular } from "../reparacaoClassificacaoCircular.js";

test("separa os dois tributos e não adivinha o lançamento sem evento", () => {
  const entries = [
    { id: "p", subtipo: "PIS_COFINS", eventType: "DARF_PIS", tipo: "PROVISAO" },
    { id: "c", subtipo: "PIS_COFINS", eventType: "DARF_COFINS", tipo: "PROVISAO" },
    { id: "x", subtipo: "PIS_COFINS", tipo: "PROVISAO" },
  ];
  const plan = planejarClassificacaoCircular(entries);
  expect(plan.changes).toEqual([{ id: "p", antes: "PIS_COFINS", depois: "PIS" }, { id: "c", antes: "PIS_COFINS", depois: "COFINS" }]);
  expect(plan.revisar).toEqual([{ id: "x", motivo: "TRIBUTO_NAO_IDENTIFICADO" }]);
  expect(entries[0].subtipo).toBe("PIS_COFINS");
});

test("completa tributo da baixa, mas não transforma provisão nem inventa banco", () => {
  const plan = planejarClassificacaoCircular([
    { id: "ir", tipo: "BAIXA", subtipo: null, eventType: "BAIXA_DARF_IRPJ" },
    { id: "cs", tipo: "BAIXA", subtipo: null, openEntry: { subtipo: "CSLL", lines: [{ tipo: "D", conta: "499" }] }, lines: [{ tipo: "C", conta: "499" }] },
    { id: "err", tipo: "PROVISAO", subtipo: "CSLL", eventType: "BAIXA_DARF_CSLL" },
  ]);
  expect(plan.changes).toEqual([{ id: "ir", antes: null, depois: "IRPJ" }, { id: "cs", antes: null, depois: "CSLL" }]);
  expect(plan.revisar).toHaveLength(2);
});

test("executar novamente sobre registros corrigidos não gera alterações", () => {
  expect(planejarClassificacaoCircular([{ id: "p", subtipo: "PIS", eventType: "DARF_PIS", tipo: "PROVISAO" },
    { id: "i", subtipo: "IRPJ", eventType: "BAIXA_DARF_IRPJ", tipo: "BAIXA" }])).toEqual({ changes: [], revisar: [] });
});
