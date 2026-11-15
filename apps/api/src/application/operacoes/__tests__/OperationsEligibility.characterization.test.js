import { regimeDoPeriodo, regimeComprovado } from '../OperationsEligibility.js';

const pa = '2026-09';
const simples = { regime: 'SIMPLES', vigenciaInicio: '2020-01-01', vigenciaFim: null };
const cadastro = { regime: 'SIMPLES_NACIONAL', dataOpcaoSN: '2020-01-01' };
const company = { regimeTributario: 'SIMPLES' };

test.each([
  ['Simples vigente', [simples], 'SIMPLES'],
  ['Presumido vigente', [{ ...simples, regime: 'LUCRO_PRESUMIDO' }], 'PRESUMIDO'],
  ['sem histórico', [], null],
  ['regime desconhecido', [{ ...simples, regime: 'UNKNOWN' }], null],
  ['início no meio do mês', [{ ...simples, vigenciaInicio: '2026-09-15' }], null],
  ['vigência encerrada', [{ ...simples, vigenciaFim: '2026-08-31' }], null],
  ['vigência futura', [{ ...simples, vigenciaInicio: '2026-10-01' }], null],
  ['sobreposição', [simples, { ...simples, regime: 'LUCRO_PRESUMIDO' }], null],
  ['data inválida', [{ ...simples, vigenciaInicio: '2026-02-30' }], null],
])('caracterização do período: %s', (_name, history, expected) => {
  expect(regimeDoPeriodo(history, pa)).toBe(expected);
});

test('fallback legado de cadastro não equivale a autorização fiscal nem substitui histórico conflitante', () => {
  expect(regimeComprovado([], pa, cadastro, company)).toBe('SIMPLES');
  expect(regimeComprovado([], pa, {}, company)).toBeNull();
  expect(regimeComprovado([], pa, { ...cadastro, dataOpcaoSN: '2026-09-02' }, company)).toBeNull();
  expect(regimeComprovado([{ ...simples, vigenciaInicio: '2026-10-01' }], pa, cadastro, company)).toBeNull();
});

test('competência inválida não possui regime histórico comprovado', () => {
  expect(regimeDoPeriodo([simples], '2026-13')).toBeNull();
  expect(regimeDoPeriodo([simples], '2026-09-01')).toBeNull();
});
