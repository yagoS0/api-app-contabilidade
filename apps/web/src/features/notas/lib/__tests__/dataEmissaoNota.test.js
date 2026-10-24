import { formatarDataEmissao } from '../dataEmissaoNota';
test.each(['UTC', 'America/Sao_Paulo'])('civil date is independent of timezone %s', timezone => {
  const old = process.env.TZ; process.env.TZ = timezone;
  try { expect(formatarDataEmissao({ issueDate: '2026-09-28T00:00:00Z', dataEmissao: { civil: '2026-09-28', motivo: null } })).toBe('28/09/2026'); }
  finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
test('legacy midnight is not proof of a civil date', () => {
  expect(formatarDataEmissao({ issueDate: '2026-09-28T00:00:00Z' })).toBe('A verificar');
  expect(formatarDataEmissao({ dataEmissao: { civil: '2026-09-28', motivo: 'FONTES_CONFLITANTES' } })).toBe('A verificar');
});
