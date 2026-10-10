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
  expect(faseAvisoGuia('2026-10-16', new Date('2026-10-16T13:00:00Z'))).toBeNull();
  expect(calendarioAvisosGuia(null)).toBeNull();
  expect(calendarioAvisosGuia('invalida')).toBeNull();
});
