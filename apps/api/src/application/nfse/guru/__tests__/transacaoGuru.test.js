import { normalizarTransacaoGuru, periodoGuru } from '../transacaoGuru.js';
import { periodo, transacao } from './fixtures/transacoesGuru.js';

test('contrato oficial financeiro sem PII, token, base, competência ou multiplicação de mensalidades', () => {
  const normalized = normalizarTransacaoGuru({ ...transacao(), contact: { name: 'privado' }, api_token: 'segredo' });
  expect(normalized.produto.idInterno).toBe('produto-interno-sintetico');
  expect(normalized.financeiro).toMatchObject({ total: 1200, parcelas: { quantidade: 12 } });
  expect(normalized.fatura).toMatchObject({ ciclo: 1, inicio: '2026-10-01', fim: '2027-09-30' });
  expect(JSON.stringify(normalized)).not.toMatch(/privado|segredo|marketplace-nao-interno|competencia|aliquota|baseFiscal/);
});
test('ausência não vira zero; status desconhecido é preservado', () => {
  expect(normalizarTransacaoGuru({ id: 'a', status: 'novo_estado' })).toMatchObject({ statusOriginal: 'novo_estado', financeiro: { total: null, moeda: null } });
});
test.each([{}, { id: 'x' }, transacao('x', { payment: { total: '1200' } }), transacao('x', { dates: { confirmed_at: '2026-10-01' } })])('recusa payload inválido %#', raw => {
  expect(() => normalizarTransacaoGuru(raw)).toThrow();
});
test('período exige pares civis válidos e limite de 180 dias', () => {
  expect(periodoGuru(periodo)).toEqual(periodo);
  for (const p of [{ ...periodo, inicio: '2026-02-30' }, { ...periodo, fim: '2026-09-01' },
    { ...periodo, inicio: '2025-01-01' }, { ...periodo, campo: 'competencia' }, { ...periodo, url: 'https://outro' }]) expect(() => periodoGuru(p)).toThrow();
});
