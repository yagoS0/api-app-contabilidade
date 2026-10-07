import { estadoInicial, validarPasso2, montarPayloadIngestao, competenciaProximaParcela, totalPrevistoRestante } from '../wizardParcelamento';

const dados = (over = {}) => ({ ...estadoInicial(), temEntrada: true, numEntradas: '1', valorEntrada: '3000', diaEntrada: '15', competenciaPrimeiraParcela: '2026-10', competenciaRegular: '2026-11', diaVencimento: '20', totalParcelas: '11', valorParcela: '700', saldoConsolidado: '10000', ...over });
test.each(['PARCSN', 'LUCRO_PRESUMIDO'])('%s preserva entrada e dez parcelas regulares no payload', tipo => {
  const d = dados({ tipo });
  expect(validarPasso2(d)).toMatchObject({ ok: true, alertas: [] });
  const { header } = montarPayloadIngestao(d);
  expect(header.cronogramaParcelas).toHaveLength(11);
  expect(header.cronogramaParcelas[0]).toMatchObject({ tipo: 'ENTRADA', valorPrevisto: 3000, vencimento: '2026-10-15' });
  expect(header.cronogramaParcelas.slice(1).every(p => p.valorPrevisto === 700 && p.tipo === 'PARCELA')).toBe(true);
  expect(header.cronogramaParcelas[10].vencimento).toBe('2027-08-20');
  expect(totalPrevistoRestante(d)).toBe(10000);
});
test('entrada dividida e histórico não repetem a entrada nas prestações restantes', () => {
  const d = dados({ numEntradas: '2', valorEntrada: '1500', competenciaRegular: '2026-12', totalParcelas: '12', situacao: 'EM_ANDAMENTO', parcelasJaPagas: '2', saldoConsolidado: '7000' });
  expect(validarPasso2(d).ok).toBe(true);
  expect(totalPrevistoRestante(d)).toBe(7000);
  expect(competenciaProximaParcela(d)).toBe('2026-12');
});
test.each([{ valorEntrada: '0' }, { numEntradas: '11' }, { competenciaRegular: '2026-09' }, { diaEntrada: '32' }])('recusa entrada inválida %j', over => expect(validarPasso2(dados(over)).ok).toBe(false));
