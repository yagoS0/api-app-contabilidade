import { validarSerieManualFs12 } from '../serieManualFs12.js';
const contexto = (inicioAtividade = '2026-09', competenciaApuracao = '2026-11') => ({ empresaId: 'c', inicioAtividade, competenciaApuracao,
  regimeDoPeriodo: { empresaId: 'c', competencia: competenciaApuracao, tipo: 'SIMPLES_NACIONAL', referencia: 'r1' } });
const serie = [{ mes: '2026-09', valorCentavos: 0 }, { mes: '2026-10', valorCentavos: 123 }];
test('zero explícito e série ordenada, total em centavos', () => {
  expect(validarSerieManualFs12(contexto(), [...serie].reverse())).toMatchObject({ serie, totalCentavos: 123 });
});
test.each([null, '', undefined, -1, 0.1, '0', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('recusa valor %s sem coerção', value => {
  expect(() => validarSerieManualFs12(contexto(), [{ ...serie[0], valorCentavos: value }, serie[1]])).toThrow();
});
test.each([[], [serie[0]], [serie[0], serie[0]], [{ ...serie[0], mes: '2026-13' }, serie[1]], [...serie, serie[0]]].map(input => [input]))('recusa meses incompletos/duplicados/extra/inválidos %#', input => {
  expect(() => validarSerieManualFs12(contexto(), input)).toThrow();
});
test('soma acima do limite seguro não é arredondada', () => {
  expect(() => validarSerieManualFs12(contexto(), [{ ...serie[0], valorCentavos: Number.MAX_SAFE_INTEGER }, serie[1]])).toThrow(/limite/);
});
test('abertura no PA exige somente mês corrente', () => {
  expect(validarSerieManualFs12(contexto('2026-11'), [{ mes: '2026-11', valorCentavos: 0 }]).totalCentavos).toBe(0);
});
test('não homologa 2027 nem presume regime', () => {
  expect(() => validarSerieManualFs12(contexto('2020-01', '2027-01'), serie)).toThrow(/contexto/);
  expect(() => validarSerieManualFs12({ ...contexto(), regimeDoPeriodo: null }, serie)).toThrow(/contexto/);
});

