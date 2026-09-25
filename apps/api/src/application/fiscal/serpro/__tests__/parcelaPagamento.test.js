import { interpretarPagamentoParcela } from "../parcelaPagamento.js";
const dados = { numeroParcelamento: 123, paDasGerado: 202609, numeroParcela: 3, numeroDas: "123456",
  dataPagamento: 20260920, valorPagoArrecadacao: 100,
  pagamentoDebitos: [{ discriminacoesDebito: [{ principal: 100, multa: 0, juros: 0, total: 100 }] }] };
const esperado = { numeroParcelamento: "123", anoMesParcela: "202609", numeroParcela: 3, numeroDocumento: "123456", valorMinimo: 100 };
const parse = extra => interpretarPagamentoParcela({ status: 200, dados: JSON.stringify({ ...dados, ...extra }) }, esperado);
const parseContrato = (local, oficial, extra = {}) => interpretarPagamentoParcela(
  { status: 200, dados: { ...dados, ...extra, numeroParcelamento: oficial } }, { ...esperado, numeroParcelamento: local });

test.each([[1, "0001"], ["0001", 1], ["1", "0001"], ["000123", "00123"],
  ["9007199254740993", "0009007199254740993"]])("contrato numérico preserva identidade com zeros à esquerda: %j / %j", (local, oficial) => {
  expect(parseContrato(local, oficial)).toMatchObject({ status: "CONFIRMADO", valorPago: 100 });
});

test.each([["1", "0002"], ["9007199254740992", "9007199254740993"]])("contratos diferentes não se confundem nem acima da precisão numérica: %j / %j", (local, oficial) => {
  expect(parseContrato(local, oficial)).toMatchObject({ status: "DIVERGENTE", motivo: "IDENTIFICACAO_DIVERGENTE" });
});

test.each([null, undefined, "", "0000", 0, -123, 123.1, Number.MAX_SAFE_INTEGER + 1,
  "abc123", "123-", "+123", "123.0", " 123", "123 ", "123\n", "1e2", true, [123], { value: 123 }])("contrato inválido não é normalizado para identificador válido: %j", invalido => {
  expect(parseContrato("123", invalido)).toMatchObject({ status: "DIVERGENTE", motivo: "IDENTIFICACAO_DIVERGENTE" });
  expect(parseContrato(invalido, "123")).toMatchObject({ status: "DIVERGENTE", motivo: "IDENTIFICACAO_DIVERGENTE" });
  expect(parseContrato(invalido, invalido)).toMatchObject({ status: "DIVERGENTE", motivo: "IDENTIFICACAO_DIVERGENTE" });
});

test("normalizar contrato não relaxa ordinal, referência, documento ou composição", () => {
  expect(parseContrato(1, "0001", { numeroParcela: 4 })).toMatchObject({ status: "DIVERGENTE", motivo: "PARCELA_DIVERGENTE" });
  expect(parseContrato(1, "0001", { paDasGerado: 202608 })).toMatchObject({ status: "DIVERGENTE", motivo: "IDENTIFICACAO_DIVERGENTE" });
  expect(parseContrato(1, "0001", { numeroDas: "000123456" })).toMatchObject({ status: "DIVERGENTE", motivo: "DOCUMENTO_DIVERGENTE" });
  expect(parseContrato(1, "0001", { valorPagoArrecadacao: 90 })).toMatchObject({ status: "DIVERGENTE", motivo: "TOTAL_DIVERGENTE" });
});

test("ausência de pagamento exige contrato válido e numericamente correspondente", () => {
  const naoPago = { dataPagamento: null, valorPagoArrecadacao: null, pagamentoDebitos: [] };
  expect(parseContrato(1, "0001", naoPago)).toMatchObject({ status: "NAO_LOCALIZADO" });
  expect(parseContrato("1", "abc1", naoPago)).toMatchObject({ status: "DIVERGENTE", motivo: "IDENTIFICACAO_DIVERGENTE" });
});
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
  expect(parse({ dataPagamento: null, valorPagoArrecadacao: null, pagamentoDebitos: [] })).toMatchObject({ status: "NAO_LOCALIZADO" });
  expect(() => interpretarPagamentoParcela({ status: 500, dados: {} }, esperado)).toThrow();
  expect(() => interpretarPagamentoParcela({ status: 200, dados: "erro" }, esperado)).toThrow();
});

test("dados de pagamento omitidos não viram resposta negativa", () => {
  const semPagamento = { numeroParcelamento: dados.numeroParcelamento, paDasGerado: dados.paDasGerado, numeroParcela: dados.numeroParcela };
  expect(interpretarPagamentoParcela({ status: 200, dados: semPagamento }, esperado)).toMatchObject({ status: "INDETERMINADO", motivo: "CAMPOS_PAGAMENTO_AUSENTES" });
});

test.each([{ valorPagoArrecadacao: "indisponível", dataPagamento: null, pagamentoDebitos: [] }, { valorPagoArrecadacao: null, dataPagamento: null }])("retorno incoerente não vira pagamento não localizado (%j)", extra => {
  expect(parse(extra).status).toBe("DIVERGENTE");
});
test("documento recalculado não impõe total maior ao comprovante original", () => {
  expect(interpretarPagamentoParcela({ status: 200, dados }, { ...esperado, valorMinimo: 100 }).status).toBe("CONFIRMADO");
});

test("juros pagos não completam principal parcialmente pago quando o principal documental é conhecido", () => {
  expect(interpretarPagamentoParcela({ status: 200, dados: { ...dados,
    pagamentoDebitos: [{ discriminacoesDebito: [{ principal: 90, juros: 10, multa: 0, total: 100 }] }] } },
  { ...esperado, principalEsperado: 100 })).toMatchObject({ status: "DIVERGENTE", motivo: "PAGAMENTO_PARCIAL" });
});

const contribuinte = { numero: "22222222000191", tipo: 2 };
const parseEmpresa = (envelopeExtra = {}, dadosExtra = {}, esperadoExtra = {}) => interpretarPagamentoParcela(
  { status: 200, contribuinte, ...envelopeExtra, dados: { ...dados, ...dadosExtra } },
  { ...esperado, contribuinteCnpj: contribuinte.numero, ...esperadoExtra });

test("CNPJ esperado corresponde ao envelope oficial, inclusive máscara válida no cadastro", () => {
  expect(parseEmpresa()).toMatchObject({ status: "CONFIRMADO" });
  expect(parseEmpresa({}, {}, { contribuinteCnpj: "22.222.222/0001-91" })).toMatchObject({ status: "CONFIRMADO" });
});

test.each([undefined, null, {}, { tipo: 2 }])("CNPJ ausente não confirma a empresa esperada: %j", valor => {
  expect(parseEmpresa({ contribuinte: valor })).toMatchObject({ status: "DIVERGENTE", motivo: "CNPJ_AUSENTE" });
});

test.each([{ numero: "11111111000191", tipo: 2 }, { numero: "22222222000191", tipo: 1 },
  { numero: "abc22222222000191", tipo: 2 }, { numero: "22222222000191\n", tipo: 2 }, { numero: "00000000000000", tipo: 2 }])("CNPJ ou tipo divergente não confirma: %j", valor => {
  expect(parseEmpresa({ contribuinte: valor })).toMatchObject({ status: "DIVERGENTE", motivo: "CNPJ_DIVERGENTE" });
});

test.each([{ cnpj: "11111111000191" }, { cnpj: null }, { cnpjContribuinte: "11111111000191" }, { contribuinte: { numero: "11111111000191", tipo: 2 } }])("CNPJ contraditório nos dados não é ignorado: %j", extra => {
  expect(parseEmpresa({}, extra)).toMatchObject({ status: "DIVERGENTE", motivo: "CNPJ_DIVERGENTE" });
});

test.each([null, "", "inválido", true])("CNPJ esperado inválido não desativa conferência: %j", valor => {
  expect(parseEmpresa({}, {}, { contribuinteCnpj: valor })).toMatchObject({ status: "DIVERGENTE", motivo: "CNPJ_ESPERADO_INVALIDO" });
});

const invalidosMonetarios = [Number.MAX_VALUE, Number.MIN_VALUE, Infinity, NaN, true, false, {}, [], "", "Infinity", "0x64", "1e2", "100,00", "100\n", "90071992547409.92", 0.001, "0.001"];
test.each(invalidosMonetarios)("valor de pagamento inválido nunca confirma nem inventa centavos: %j", valor => {
  const r = parseEmpresa({}, { valorPagoArrecadacao: valor });
  expect(r).toMatchObject({ status: "DIVERGENTE", motivo: "PAGAMENTO_INCOMPLETO", valorPago: null });
});

test.each(invalidosMonetarios)("valor inválido de composição ou piso não é ignorado: %j", valor => {
  expect(parseEmpresa({}, { pagamentoDebitos: [{ discriminacoesDebito: [{ principal: valor, juros: 0, multa: 0, total: 100 }] }] }))
    .toMatchObject({ status: "DIVERGENTE", motivo: "COMPOSICAO_DIVERGENTE" });
  expect(parseEmpresa({}, {}, { valorMinimo: valor })).toMatchObject({ status: "DIVERGENTE", motivo: "VALOR_ESPERADO_INVALIDO" });
  expect(parseEmpresa({}, {}, { principalEsperado: valor })).toMatchObject({ status: "DIVERGENTE", motivo: "VALOR_ESPERADO_INVALIDO" });
});

test("overflow do total e da composição não retorna Infinity como pagamento", () => {
  expect(parseEmpresa({}, { valorPagoArrecadacao: Number.MAX_VALUE,
    pagamentoDebitos: [{ discriminacoesDebito: [{ principal: Number.MAX_VALUE, juros: 0, multa: 0, total: Number.MAX_VALUE }] }] }))
    .toMatchObject({ status: "DIVERGENTE", motivo: "PAGAMENTO_INCOMPLETO", valorPago: null });
});

test("soma de linhas e soma dos componentes também precisam de centavos seguros", () => {
  const grande = "45035996273704.96";
  expect(parseEmpresa({}, { pagamentoDebitos: [{ discriminacoesDebito: [
    { principal: grande, juros: 0, multa: 0, total: grande }, { principal: grande, juros: 0, multa: 0, total: grande },
  ] }] })).toMatchObject({ status: "DIVERGENTE", motivo: "COMPOSICAO_DIVERGENTE" });
  expect(parseEmpresa({}, { pagamentoDebitos: [{ discriminacoesDebito: [
    { principal: grande, juros: grande, multa: 0, total: grande },
  ] }] })).toMatchObject({ status: "DIVERGENTE", motivo: "COMPOSICAO_DIVERGENTE" });
});

test("decimais válidos e zeros legítimos preservam pagamento e ausência explícita", () => {
  expect(parseEmpresa({}, { valorPagoArrecadacao: "100.00", saldoDevedor: "0.00", saldoRemanescente: 0,
    pagamentoDebitos: [{ discriminacoesDebito: [{ principal: "100.000", juros: 0, multa: "0.00", total: "100.00" }] }] },
  { principalEsperado: "0.00", valorMinimo: 0 })).toMatchObject({ status: "CONFIRMADO", valorPago: 100 });
  expect(parseEmpresa({}, { valorPagoArrecadacao: "0.00", dataPagamento: null, pagamentoDebitos: [] }))
    .toMatchObject({ status: "NAO_LOCALIZADO" });
  expect(parseEmpresa({}, { valorPagoArrecadacao: false, dataPagamento: null, pagamentoDebitos: [] })).toMatchObject({ status: "DIVERGENTE" });
});

test.each([true, {}, "inválido", Infinity])("saldo inválido não é convertido em saldo zero: %j", saldo => {
  expect(parseEmpresa({}, { saldoDevedor: saldo })).toMatchObject({ status: "DIVERGENTE", motivo: "SALDO_INVALIDO" });
});
