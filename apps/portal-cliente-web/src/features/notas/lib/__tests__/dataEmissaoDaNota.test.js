import { dataEmissaoDaNota } from '../dataEmissaoDaNota';
test('civil documentary date is independent of browser timezone and legacy midnight', () => {
  expect(dataEmissaoDaNota({ issueDate: '2026-09-28T00:00:00Z', dataEmissao: { civil: '2026-09-28', motivo: null } })).toBe('28/09/2026');
});
test.each([undefined, { civil: '2026-02-29' }, { civil: '2026-09-28', motivo: 'IDENTIDADE_DIVERGENTE' }])('unknown or inconsistent evidence stays explicit', dataEmissao => {
  expect(dataEmissaoDaNota({ dataEmissao, issueDate: '2026-09-28T00:00:00Z' })).toBe('A verificar');
});
