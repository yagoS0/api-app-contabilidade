import { parseRetornoSimulacao } from "../PgdasSimulacaoService.js";

test.each([undefined, null, "", " ", false, true, "inválido", NaN, Infinity, -1, "-1"])("valor inválido %s não vira DAS zero e preserva declaração", valor => {
  const result = parseRetornoSimulacao({ dados: { idDeclaracao: "declaracao-confirmada", valoresDevidos: [{ codigoTributo: 1001, valor }] } });
  expect(result.dasValor).toBeNull();
  expect(result.tributos[0].valor).toBeNull();
  expect(result.numeroDeclaracao).toBe("declaracao-confirmada");
});

test.each([0, "0", 6, "6.25"])("valor numérico explícito %s é válido", valor => {
  const result = parseRetornoSimulacao({ dados: JSON.stringify({ valoresDevidos: [{ codigoTributo: 1001, valor }] }) });
  expect(result.dasValor).toBe(Number(valor));
});

test.each([null, [], [{}], [null], [{ valor: 1 }, {}], [{ valor: Number.MAX_VALUE }, { valor: Number.MAX_VALUE }]])("tributos incompletos ou soma infinita não geram DAS: %j", valoresDevidos => {
  expect(parseRetornoSimulacao({ dados: { valoresDevidos } }).dasValor).toBeNull();
});
