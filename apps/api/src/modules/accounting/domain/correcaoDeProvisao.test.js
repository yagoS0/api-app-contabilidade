import { motivoImpedimentoDaProvisao, motivoImpedimentoPorFechamento } from "./correcaoDeProvisao.js";

const companyId = "empresa";
const atual = "100.00";
const novo = 125.25;
const editavel = {
  portalClientId: companyId, status: "RASCUNHO", tipo: "PROVISAO", statusPagamento: "ABERTO",
  baixas: [], lines: [{ tipo: "D", valor: atual }, { tipo: "C", valor: atual }],
};
const avaliar = entradas => motivoImpedimentoDaProvisao(entradas, companyId, atual, novo);

test("guia sem provisão passa pela regra de lançamentos", () => {
  expect(avaliar([])).toBeNull();
});

test.each([atual, novo, "125.249"])("aceita partidas balanceadas em centavos pelo valor atual ou pretendido (%s)", valor => {
  const lines = [{ tipo: "C", valor }, { tipo: "D", valor }];
  expect(avaliar([{ ...editavel, lines }])).toBeNull();
});

test("provisão composta tem prioridade sobre a condição e as partidas dos lançamentos", () => {
  const invalido = { ...editavel, status: "EXPORTADO", lines: [] };
  expect(avaliar([invalido, invalido])).toEqual({
    code: "provisao_composta", message: "Há mais de um lançamento vinculado. Revise a composição antes de corrigir.",
  });
});

test.each([
  ["portalClientId", "outra"], ["status", "CONFIRMADO"], ["tipo", "BAIXA"], ["statusPagamento", "PAGO"],
  ["baixas", [{ id: "baixa" }]], ["parcelamentoId", "p"], ["circularId", "c"],
  ["openEntryId", "a"], ["estornoDeEntryId", "e"],
])("o impedimento em %s precede a divergência das partidas", (campo, valor) => {
  expect(avaliar([{ ...editavel, [campo]: valor, lines: [] }])).toEqual({
    code: "provisao_nao_editavel", message: "O lançamento vinculado exige revisão contábil antes da correção.",
  });
});

test.each([
  { linhas: [] },
  { linhas: [{ tipo: "D", valor: 100 }] },
  { linhas: [...editavel.lines, { tipo: "D", valor: 0 }] },
  { linhas: [{ tipo: "D", valor: 100 }, { tipo: "D", valor: 100 }] },
  { linhas: [{ tipo: "C", valor: 100 }, { tipo: "C", valor: 100 }] },
  { linhas: [{ tipo: "D", valor: 100 }, { tipo: "C", valor: 100.01 }] },
  { linhas: [{ tipo: "D", valor: 99 }, { tipo: "C", valor: 99 }] },
])("recusa partidas incompatíveis $linhas", ({ linhas }) => {
  expect(avaliar([{ ...editavel, lines: linhas }])).toEqual({
    code: "provisao_divergente", message: "Os valores do lançamento não correspondem à guia. Revise o lançamento.",
  });
});

test("qualquer competência fechada entre as consultadas impede a correção", () => {
  expect(motivoImpedimentoPorFechamento(new Set())).toBeNull();
  expect(motivoImpedimentoPorFechamento(new Set(["2026-09"]))).toEqual({
    code: "competencia_fechada", message: "A competência está fechada e não permite esta correção.",
  });
});
