import { normalizeRegimeHistorico } from '../companyProfile.js';
const periodo = { regime: 'SIMPLES', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-01-31' };
test('aceita datas serializadas do banco sem aceitar datas impossíveis', () => {
  expect(normalizeRegimeHistorico([{ ...periodo, vigenciaInicio: '2026-01-01T00:00:00.000Z' }]).ok).toBe(true);
  expect(normalizeRegimeHistorico([{ ...periodo, vigenciaInicio: '2026-02-30T00:00:00.000Z' }]).ok).toBe(false);
});
test('ausente preserva; vazio permite limpar', () => {
  expect(normalizeRegimeHistorico(undefined).data).toBeNull();
  expect(normalizeRegimeHistorico([]).data).toEqual([]);
});
test('rejeita data impossível, linha incompleta e formato inválido', () => {
  expect(normalizeRegimeHistorico([{ ...periodo, vigenciaInicio: '2026-02-30' }]).ok).toBe(false);
  expect(normalizeRegimeHistorico([{ ...periodo, regime: '' }]).ok).toBe(false);
  expect(normalizeRegimeHistorico({}).ok).toBe(false);
});
test('fim inclusivo impede sobreposição e períodos abertos concorrentes', () => {
  expect(normalizeRegimeHistorico([periodo, { ...periodo, vigenciaInicio: '2026-01-31', vigenciaFim: null }]).error).toBe('company_regime_historico_sobreposto');
  expect(normalizeRegimeHistorico([{ ...periodo, vigenciaFim: null }, { ...periodo, vigenciaInicio: '2026-02-01', vigenciaFim: null }]).ok).toBe(false);
  expect(normalizeRegimeHistorico([periodo, { ...periodo, vigenciaInicio: '2026-02-01', vigenciaFim: null }]).ok).toBe(true);
});
