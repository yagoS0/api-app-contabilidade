import { exigirDespachoPgdasFs12Permitido, exigirEnvelopePgdasFs12Permitido } from '../guardaPgdasFs12.js';
const envelope = dados => ({ pedidoDados: { idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', dados: JSON.stringify(dados) } });
test.each(['2018-01', '2026-01', '2026-10'])('preserva despacho legado %s', competencia => {
  expect(() => exigirDespachoPgdasFs12Permitido({ competencia })).not.toThrow();
});
test.each([['2026-11', 'FS12_INTEGRACAO_B33_PENDENTE'], ['2026-12', 'FS12_INTEGRACAO_B33_PENDENTE'], ['2027-01', 'FS12_HOMOLOGACAO_2027_PENDENTE'], ['2028-02', 'FS12_HOMOLOGACAO_2027_PENDENTE']])('bloqueia %s', (competencia, code) => {
  expect(() => exigirDespachoPgdasFs12Permitido({ competencia })).toThrow(expect.objectContaining({ code }));
});
test.each([null, undefined, '', '2026-13', '202611', 202611])('competência inválida %s não libera', competencia => {
  expect(() => exigirDespachoPgdasFs12Permitido({ competencia })).toThrow(expect.objectContaining({ code: 'FS12_COMPETENCIA_INVALIDA' }));
});
test.each([{ pa: 202610 }, { _periodoApuracao: '202610' }, { pa: 202610, _periodoApuracao: '202610' }])('mantém forma legada %j', dados => {
  expect(() => exigirEnvelopePgdasFs12Permitido({ payload: envelope(dados) })).not.toThrow();
});
test.each([{}, { pa: null }, { pa: 202613 }, { pa: 202610, _periodoApuracao: '202611' }, { pa: 202611, _periodoApuracao: '202610' }, { pa: null, _periodoApuracao: '202610' }])('ausência, conflito ou formato inválido %j não liberam', dados => {
  expect(() => exigirEnvelopePgdasFs12Permitido({ payload: envelope(dados) })).toThrow(expect.objectContaining({ code: 'FS12_COMPETENCIA_INVALIDA' }));
});
test('JSON inválido não libera; consulta documental não ganha exigência de FS12', () => {
  const payload = envelope({ pa: 202611 }); payload.pedidoDados.dados = '{';
  expect(() => exigirEnvelopePgdasFs12Permitido({ payload })).toThrow();
  payload.pedidoDados.idServico = 'CONSDECLARACAO13';
  expect(() => exigirEnvelopePgdasFs12Permitido({ payload })).not.toThrow();
});
