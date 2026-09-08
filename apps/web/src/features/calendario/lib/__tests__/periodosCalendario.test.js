import { agendaDoMes, deslocarMes, segmentosDaSemana } from "../periodosCalendario";

const semana = Array.from({ length: 7 }, (_, i) => ({ data: `2026-09-${String(6 + i).padStart(2, "0")}` }));
test("intervalo maior que o mês ocupa todos os dias da semana e indica as duas continuações", () => {
  const item = { id: "a", tipo: "obrigacao", dataInicio: "2026-08-20", dataFim: "2026-10-10" };
  const porDia = Object.fromEntries(semana.map(({ data }) => [data, [item]]));
  expect(segmentosDaSemana(semana, porDia)).toEqual([{ item, colunaInicio: 0, colunaFim: 6, linha: 0, continuaAntes: true, continuaDepois: true }]);
});

test("faixas sobrepostas não ocupam a mesma pista e faixas separadas podem reutilizá-la", () => {
  const a = { id: "a", tipo: "obrigacao", dataInicio: "2026-09-06", dataFim: "2026-09-08" };
  const b = { id: "b", tipo: "obrigacao", dataInicio: "2026-09-07", dataFim: "2026-09-09" };
  const c = { id: "c", tipo: "obrigacao", dataInicio: "2026-09-10", dataFim: "2026-09-12" };
  const porDia = Object.fromEntries(semana.map(({ data }) => [data, [a, b, c].filter((item) => item.dataInicio <= data && item.dataFim >= data)]));
  expect(segmentosDaSemana(semana, porDia).map(({ item, linha }) => [item.id, linha])).toEqual([["a", 0], ["b", 1], ["c", 0]]);
});

test("Agenda deduplica por tipo e id e encontra ocorrência que iniciou antes do mês", () => {
  const tarefa = { id: "x", tipo: "obrigacao", dataInicio: "2026-08-29", dataFim: "2026-09-03" };
  const guia = { id: "x", tipo: "guia", data: "2026-09-02" };
  const agenda = agendaDoMes("2026-09", { "2026-08-31": [tarefa], "2026-09-01": [tarefa], "2026-09-02": [tarefa, guia], "2026-09-03": [tarefa] });
  expect(agenda).toEqual([{ data: "2026-09-01", dia: 1, itens: [tarefa] }, { data: "2026-09-02", dia: 2, itens: [guia] }]);
});

test.each([28, 29, 30, 31])("recuar março no dia %i não pula fevereiro", (dia) => {
  expect(deslocarMes(`2024-03-${dia}`, -1)).toBe("2024-02-01");
});
