import { calendarioAvisosGuia, faseAvisoGuia } from '../calendarioAvisosGuia.js';

test.each(['2026-10-17', '2026-10-18'] )('fim de semana %s antecipa para sexta, avisa quinta e segunda', data => {
  expect(calendarioAvisosGuia(data)).toEqual({ vencimento: '2026-10-16', antes: '2026-10-15', depois: '2026-10-19' });
});
test('segunda avisa sexta e terça', () => {
  expect(calendarioAvisosGuia('2026-10-19')).toEqual({ vencimento: '2026-10-19', antes: '2026-10-16', depois: '2026-10-20' });
});
test('feriados cadastrados respeitam município e atravessam ano', () => {
  const feriados = [{ data: '2027-01-01', abrangencia: 'NACIONAL' }, { data: '2026-12-31', abrangencia: 'MUNICIPAL', municipio: 'Contagem' }];
  expect(calendarioAvisosGuia('2027-01-02', feriados, 'Contagem')).toEqual({ vencimento: '2026-12-30', antes: '2026-12-29', depois: '2027-01-04' });
  expect(calendarioAvisosGuia('2027-01-02', feriados, 'Outra')).toEqual({ vencimento: '2026-12-31', antes: '2026-12-30', depois: '2027-01-04' });
});
test('dia local de São Paulo, não dia UTC; datas ausentes não disparam', () => {
  expect(faseAvisoGuia('2026-10-16', new Date('2026-10-16T01:00:00Z'))).toBe('ANTES');
  expect(faseAvisoGuia('2026-10-16', new Date('2026-10-16T13:00:00Z'))).toBe('NO_VENCIMENTO');
  expect(calendarioAvisosGuia(null)).toBeNull();
  expect(calendarioAvisosGuia('invalida')).toBeNull();
});

test.each([null, undefined, '', 'invalida', '2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-02-30T12:00:00Z', 123, true, new Date(NaN)])('vencimento inválido %s não inventa data', data => {
  expect(calendarioAvisosGuia(data)).toBeNull();
  expect(faseAvisoGuia(data, new Date('2026-03-02T12:00:00Z'))).toBeNull();
});

test('ano bissexto e Date persistida conservam a data válida', () => {
  expect(calendarioAvisosGuia('2028-02-29').vencimento).toBe('2028-02-29');
  expect(calendarioAvisosGuia(new Date('2026-10-16T00:00:00Z'))).toEqual(calendarioAvisosGuia('2026-10-16'));
});

test('D0 usa vencimento ajustado e muda à meia-noite de Brasília', () => {
  expect(faseAvisoGuia('2026-10-18', new Date('2026-10-16T02:59:59Z'))).toBe('ANTES');
  expect(faseAvisoGuia('2026-10-18', new Date('2026-10-16T03:00:00Z'))).toBe('NO_VENCIMENTO');
  expect(faseAvisoGuia('2026-10-18', new Date('2026-10-18T12:00:00Z'))).toBeNull();
  expect(faseAvisoGuia('2027-01-01', new Date('2026-12-31T12:00:00Z'), [{ data: '2027-01-01', abrangencia: 'NACIONAL' }])).toBe('NO_VENCIMENTO');
});

test.each(['0001-01-01', '0099-01-01', new Date('0001-01-01'), new Date('0099-01-01')])('recusa ano alterado pela conversão sem inventar vencimento: %s', data => { expect(calendarioAvisosGuia(data)).toBeNull(); });
