import { calendarioEnvioGuias, decidirEnvioGuias } from '../calendarioEnvioGuias.js';

test.each([['2026-06', '2026-06-12'], ['2026-09', '2026-09-11'], ['2026-11', '2026-11-13']])('corte no dia 13 civil, antecipado: %s', (mesOperacional, expected) => {
  expect(calendarioEnvioGuias({ mesOperacional, feriados: [] }).cutoffDate).toBe(expected);
});
test('feriados nacionais e municipais respeitam localidade', () => {
  const feriados = [{ data: '2026-11-13', abrangencia: 'NACIONAL' }, { data: '2026-11-12', abrangencia: 'MUNICIPAL', municipio: 'Cidade sintética' }];
  expect(calendarioEnvioGuias({ mesOperacional: '2026-11', municipio: 'Cidade sintética', feriados }).cutoffDate).toBe('2026-11-11');
  expect(calendarioEnvioGuias({ mesOperacional: '2026-11', municipio: 'Outra', feriados }).cutoffDate).toBe('2026-11-12');
});
test('D−2 úteis cruza mês e conserva vencimento nominal', () => {
  const input = { mesOperacional: '2026-06', vencimento: '2026-06-01', feriados: [] };
  expect(calendarioEnvioGuias(input)).toMatchObject({ advanceDate: '2026-05-28', vencimento: '2026-06-01' });
  expect(input.vencimento).toBe('2026-06-01');
});
test('vencimento posterior ao corte não antecipa', () => {
  expect(calendarioEnvioGuias({ mesOperacional: '2026-11', vencimento: '2026-11-20', feriados: [] }).advanceDate).toBeNull();
});
test('D−2 parte do vencimento útil e não modifica sábado nominal', () => {
  expect(calendarioEnvioGuias({ mesOperacional: '2026-11', vencimento: '2026-11-07', feriados: [] }))
    .toMatchObject({ advanceDate: '2026-11-04', vencimento: '2026-11-07' });
});
test.each(['2026-02-30', '2026-13-01', 'invalid'])('recusa vencimento impossível %s', vencimento => {
  expect(() => calendarioEnvioGuias({ mesOperacional: '2026-02', vencimento, feriados: [] })).toThrow();
});
test('feriados indisponíveis não são calendário vazio', () => {
  expect(() => calendarioEnvioGuias({ mesOperacional: '2026-11' })).toThrow();
});
test('corte usa dia civil de Brasília e incompletude nunca vira completo', () => {
  const input = { expectationKnown: false, missingCount: 0, availableCount: 1,
    calendar: calendarioEnvioGuias({ mesOperacional: '2026-11', feriados: [] }) };
  expect(decidirEnvioGuias({ ...input, now: new Date('2026-11-13T02:59:59Z') }).kind).toBe('REVIEW');
  expect(decidirEnvioGuias({ ...input, now: new Date('2026-11-13T03:00:00Z') }).kind).toBe('PARTIAL_DEADLINE');
});
test('completo e complemento dependem de documentos disponíveis e expectativa conhecida', () => {
  const input = { expectationKnown: true, missingCount: 0, availableCount: 2,
    calendar: calendarioEnvioGuias({ mesOperacional: '2026-11', feriados: [] }), now: new Date('2026-11-04T12:00:00Z') };
  expect(decidirEnvioGuias(input).kind).toBe('COMPLETE');
  expect(decidirEnvioGuias({ ...input, hasPriorDelivery: true }).kind).toBe('COMPLEMENT');
  expect(decidirEnvioGuias({ ...input, availableCount: 0 }).kind).toBe('WAIT');
});
