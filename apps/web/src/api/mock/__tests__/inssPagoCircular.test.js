import { createMockApi } from "../mockApi";

test("mock deriva circular da baixa editada e preserva o valor da guia consultada", async () => {
  const api = createMockApi();
  const companyId = "04bf356c-cfe9-43fa-bee4-a0180cf8f114";
  const ano = new Date().getFullYear();
  const antes = await api.getCircular(companyId, { year: ano });
  const inss = antes.provisoes.find((p) => p.id.startsWith("synthetic-inss-mock-inss-pago-"));
  expect(inss.valor).toBe(1000);
  expect(inss.sourceGuide.valor).toBe(1100);
  await api.updateAccountingEntry(companyId, inss.baixaEntry.id, { lines: inss.baixaEntry.lines.map((l) => ({ ...l, valor: 990 })) });
  const depois = await api.getCircular(companyId, { year: ano });
  const atualizado = depois.provisoes.find((p) => p.id === inss.id);
  expect(atualizado.valor).toBe(990);
  expect(atualizado.pagamentoEfetivo.total).toBe(990);
  expect(atualizado.sourceGuide.valor).toBe(1100);
  const folha = await api.getPayrollTemplate(companyId, "PROLABORE", `${ano}-08`);
  expect(folha.template.valorRetencaoInss).toBeNull();
  expect(folha.template.inssGuide.valor).toBe(1100);
});
