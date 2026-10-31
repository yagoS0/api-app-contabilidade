import { operationDate, operationMoney, operationInstant } from '../operationsDetails';
test.each([null, '', '2026-02-30', '2026-13-01', '2026-10-10T99:00'])('data inválida %s permanece a verificar', value => {
  expect(operationDate(value)).toBe('A verificar');
});
test('data civil não desloca de dia; zero explícito difere de ausência', () => {
  expect(operationDate('2026-10-30')).toBe('30/10/2026');
  expect(operationMoney(0)).toContain('0,00');
  for (const value of [null, undefined, '', false, NaN]) expect(operationMoney(value)).toBe('Não disponível');
});

test('instantes usam Brasília e datas civis não mudam', () => {
  expect(operationInstant('2026-10-30T02:00:00Z')).toContain('29/10/2026');
  expect(operationDate('2026-10-30T00:00:00Z')).toBe('30/10/2026');
  expect(operationInstant('2026-02-30T02:00:00Z')).toBe('A verificar');
});
