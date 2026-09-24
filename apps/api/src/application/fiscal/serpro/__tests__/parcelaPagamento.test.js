import { interpretarPagamentoParcela } from "../parcelaPagamento.js";
const dados = { numeroParcelamento: 123, paDasGerado: 202609, numeroParcela: 3, numeroDas: "123456",
  dataPagamento: 20260920, valorPagoArrecadacao: 100,
  pagamentoDebitos: [{ discriminacoesDebito: [{ principal: 100, multa: 0, juros: 0, total: 100 }] }] };
const esperado = { numeroParcelamento: "123", anoMesParcela: "202609", numeroParcela: 3, numeroDocumento: "123456", valorMinimo: 100 };
const parse = extra => interpretarPagamentoParcela({ status: 200, dados: JSON.stringify({ ...dados, ...extra }) }, esperado);
test("pagamento pontual preserva principal sem juros e data real", () => {
  expect(parse({})).toMatchObject({ status: "CONFIRMADO", valorPago: 100, pagoEm: new Date("2026-09-20Z"), comprovante: { principal: 100, juros: 0 } });
});
test.each([{ numeroParcelamento: 222 }, { paDasGerado: 202608 }, { numeroParcela: 2 }, { numeroDas: "999" }])("identidade divergente nunca quita: %j", extra => {
  expect(parse(extra).status).toBe("DIVERGENTE");
});
test.each([{ dataPagamento: 20260230 }, { valorPagoArrecadacao: 90 }, { pagamentoDebitos: [] }, { pagamentoParcial: true }, { saldoDevedor: 1 }])("pagamento parcial/inconsistente não quita: %j", extra => {
  expect(parse(extra).status).toBe("DIVERGENTE");
});
test("ausência correlacionada é diferente de erro e pagamento", () => {
  expect(parse({ dataPagamento: null, valorPagoArrecadacao: null })).toMatchObject({ status: "NAO_LOCALIZADO" });
  expect(() => interpretarPagamentoParcela({ status: 500, dados: {} }, esperado)).toThrow();
  expect(() => interpretarPagamentoParcela({ status: 200, dados: "erro" }, esperado)).toThrow();
});
test("documento recalculado não impõe total maior ao comprovante original", () => {
  expect(interpretarPagamentoParcela({ status: 200, dados }, { ...esperado, valorMinimo: 100 }).status).toBe("CONFIRMADO");
});

test("juros pagos não completam principal parcialmente pago quando o principal documental é conhecido", () => {
  expect(interpretarPagamentoParcela({ status: 200, dados: { ...dados,
    pagamentoDebitos: [{ discriminacoesDebito: [{ principal: 90, juros: 10, multa: 0, total: 100 }] }] } },
  { ...esperado, principalEsperado: 100 })).toMatchObject({ status: "DIVERGENTE", motivo: "PAGAMENTO_PARCIAL" });
});
