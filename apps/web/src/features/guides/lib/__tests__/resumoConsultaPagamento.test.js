import { resumoConsultaPagamentoLote } from "../resumoConsultaPagamento.js";
test.each([
  { indeterminados: 1 }, { divergentes: 1 }, { semDoc: 1 }, { naoAplicavel: 1 }, { cobertura: "PARCIAL" },
])("lote incompleto não ganha OK mesmo com pagamento confirmado: %j", (parcial) => {
  const r = resumoConsultaPagamentoLote({ total: 2, paid: 1, errors: 0, ...parcial });
  expect(r).toMatchObject({ ok: false, parcial: true }); expect(r.message).not.toMatch(/Nenhum pago/);
});
test("falha parcial não fica verde só porque outra guia foi confirmada", () => {
  expect(resumoConsultaPagamentoLote({ total: 2, paid: 1, errors: 1 }).ok).toBe(false);
});
test("negativo válido é resultado da consulta, sem afirmar inadimplência", () => {
  expect(resumoConsultaPagamentoLote({ total: 2, naoLocalizado: 2 })).toMatchObject({ ok: true });
  expect(resumoConsultaPagamentoLote({ total: 2, naoLocalizado: 2 }).message).toContain("até a consulta");
});
test("preserva a explicação detalhada do servidor", () => {
  expect(resumoConsultaPagamentoLote({ total: 1, indeterminados: 1, mensagem: "Consulta inconclusiva para este documento." }))
    .toMatchObject({ ok: false, message: "Consulta inconclusiva para este documento." });
});
