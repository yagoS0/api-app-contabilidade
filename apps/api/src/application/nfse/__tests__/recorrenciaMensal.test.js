import { hojeEmSaoPaulo, dataDoMes, proximaData, validarAgenda } from '../recorrenciaMensal.js';

test('calendário civil de São Paulo perto da meia-noite UTC', () => {
  expect(hojeEmSaoPaulo(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09-30');
});
test('dia 31 não deriva após fevereiro e considera ano bissexto', () => {
  expect(dataDoMes('2028-02', 31)).toBe('2028-02-29');
  expect(dataDoMes('2027-02', 31)).toBe('2027-02-28');
  expect(proximaData('2027-02-28', 31)).toBe('2027-03-31');
  expect(proximaData('2026-12-31', 31)).toBe('2027-01-31');
});
test.each([{ dia: 0, inicio: '2026-10-06' }, { dia: 32, inicio: '2026-10-06' },
  { dia: 6.5, inicio: '2026-10-06' }, { dia: 6, inicio: '2026-13-06' },
  { dia: 31, inicio: '2027-02-31' }, { dia: 6, inicio: '2026-10-05' }])('recusa agenda inválida %j', agenda => {
  expect(() => validarAgenda(agenda, '2026-10-06')).toThrow();
});
test('permite último dia para agendamento no dia 31', () => {
  expect(validarAgenda({ dia: 31, inicio: '2027-02-28' }, '2026-10-06').dia).toBe(31);
});
