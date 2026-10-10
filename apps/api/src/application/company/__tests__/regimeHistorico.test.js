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

const hibrido = { regime: 'SIMPLES', vigenciaInicio: '2027-01-01', vigenciaFim: null, apuracaoIbsCbs: 'REGULAR', comprovanteOpcaoIbsCbs: 'Protocolo teste' };
test('normaliza opção e comprovante; legado continua sem opção presumida', () => {
  expect(normalizeRegimeHistorico([hibrido]).data[0]).toMatchObject({ apuracaoIbsCbs: 'REGULAR', comprovanteOpcaoIbsCbs: 'Protocolo teste' });
  expect(normalizeRegimeHistorico([periodo]).data[0].apuracaoIbsCbs).toBeNull();
});
test.each([
  { regime: 'MEI' }, { regime: 'LUCRO_PRESUMIDO' }, { apuracaoIbsCbs: 'INVALIDO' },
  { vigenciaInicio: '2026-12-31' }, { comprovanteOpcaoIbsCbs: '' },
])('rejeita opção incompatível ou sem prova: %j', alteracao => {
  expect(normalizeRegimeHistorico([{ ...hibrido, ...alteracao }]).ok).toBe(false);
});
test('mudança de opção exige períodos distintos sem sobreposição', () => {
  const primeiro = { ...hibrido, apuracaoIbsCbs: 'NO_DAS', vigenciaFim: '2027-06-30' };
  expect(normalizeRegimeHistorico([primeiro, { ...hibrido, vigenciaInicio: '2027-07-01' }]).ok).toBe(true);
  expect(normalizeRegimeHistorico([primeiro, { ...hibrido, vigenciaInicio: '2027-06-30' }]).ok).toBe(false);
});
