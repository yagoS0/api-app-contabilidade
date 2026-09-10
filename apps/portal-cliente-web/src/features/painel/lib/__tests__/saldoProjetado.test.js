import { linhaDoMes, linhasDosDias } from "../tabelaDoFluxo";
test("projeção diária preserva inicial em mês vazio sem inventar resultado mensal", () => {
  const mes = { competencia: "2026-09", linhas: [], saldo: { inicial: 900, final: 900, projetado: true } };
  expect(linhaDoMes(mes)).toMatchObject({ resultado: null, saldo: { valor: 900, status: "forecast" } });
  expect(linhasDosDias(mes, 30).dias.every(d => d.saldo.valor === 900)).toBe(true);
});
test("saldo transportado pelo backend soma resultado diário e continua projetado", () => {
  const mes = { competencia: "2026-09", saldo: { inicial: 1000, final: 900, projetado: true }, linhas: [{ fonte: "DESPESA_LANCADA", direcao: "SAIDA", procedencia: "FATO", dia: 2, valor: 100 }] };
  const dias = linhasDosDias(mes, 30).dias;
  expect(dias[0].saldo.valor).toBe(1000); expect(dias[1].saldo).toEqual({ valor: 900, status: "forecast" });
  expect(dias[29].resultado.valor).toBe(-100); expect(dias[29].saldo.valor).toBe(900);
});
test("ausência de âncora ou mês anterior não vira saldo zero", () => {
  for (const saldo of [undefined, { inicial: null, final: null, projetado: true }]) {
    const mes = { competencia: "2026-08", linhas: [], saldo };
    expect(linhaDoMes(mes).saldo).toBeNull(); expect(linhasDosDias(mes, 31).dias.every(d => d.saldo === null)).toBe(true);
  }
});
