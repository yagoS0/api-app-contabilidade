import { resumoCapturaNotas } from '../resumoCapturaNotas';
const agora = Date.parse('2026-10-25T15:00:00Z');
const ler = (adnState, extra = {}) => resumoCapturaNotas({ adnState, agora, ...extra }).texto;
test('recebimento não se transforma em busca ou sucesso', () => {
  expect(ler({ adnLastSyncAt: '2026-10-25T14:00:00Z' })).toContain('sem tentativa registrada');
  const texto = ler({ adnLastAttemptAt: '2026-10-25T12:00:00Z', adnLastSyncAt: '2020-01-01' });
  expect(texto).toContain('25/10/2026'); expect(texto).not.toMatch(/sucesso|nota nova|2020/);
});
test.each(['inválida', '2026-02-30T12:00:00Z', '2026-10-26T12:00:00Z'])('timestamp %s permanece a verificar', data => {
  expect(ler({ adnLastAttemptAt: data })).toContain('data da tentativa a verificar');
});
test('ausência, carga e falha não significam consulta vazia', () => {
  expect(ler(null)).toContain('indisponível'); expect(ler({}, { loading: true })).toContain('carregando');
  expect(ler({}, { error: 'offline' })).toContain('indisponível'); expect(ler({})).toContain('sem tentativa registrada');
});
test('erro é identificado com data da tentativa; NF-e usa evidência própria', () => {
  expect(ler({ adnLastAttemptAt: '2026-10-24T12:00:00Z', adnLastError: 'falhou' })).toMatch(/24\/10\/2026.*tentativa com erro/);
  expect(ler({ adnLastAttemptAt: '2026-10-24T12:00:00Z' }, { tipo: 'NFE', dfeState: {} })).toContain('NF-e: sem tentativa registrada');
  expect(ler(null, { tipo: 'NFE', dfeState: { ultimaConsultaEm: '2026-10-23T12:00:00Z', dfeLastError: 'erro' } })).toMatch(/23\/10\/2026.*tentativa com erro/);
});
