import { buildDTOsFromManual } from '../entradaManual.js';
import { sincronizarParcelas } from '../parcelaSync.js';
import { gerarCronogramaComEntrada } from '../../../../../../../packages/shared/src/accounting/cronogramaParcelamento.js';

const cronograma = () => gerarCronogramaComEntrada({ numEntradas: 1, valorEntrada: 3000, competenciaEntrada: '2026-10', diaEntrada: 15, totalParcelas: 11, valorParcela: 700, competenciaRegular: '2026-11', diaRegular: 20 });
test.each(['PARCSN', 'LUCRO_PRESUMIDO'])('%s sincroniza valores individuais sem sobrescrever pagamento existente', async tipo => {
  const { parcelamentoDTO } = buildDTOsFromManual({ header: { tipo, quantidadeParcelas: 11, cronogramaParcelas: cronograma() } });
  const rows = [{ id: 'p1', numeroParcela: 1, guiaId: 'g1', valorPrevisto: 3000, origemBaixa: 'MANUAL' }];
  const db = { parcelamento: { findFirst: async () => ({ id: 'c', portalClientId: 'empresa', numParcelas: 11, valorParcelaReferencia: 700, cronogramaParcelas: parcelamentoDTO.cronogramaParcelas }) }, guide: { findMany: async () => [] }, parcela: { findMany: async () => rows, create: jest.fn(async ({ data }) => { const p = { ...data, id: 'p' + data.numeroParcela }; rows.push(p); return p; }), update: jest.fn() } };
  await sincronizarParcelas(db, { portalClientId: 'empresa', parcelamentoId: 'c' });
  await sincronizarParcelas(db, { portalClientId: 'empresa', parcelamentoId: 'c' });
  expect(rows).toHaveLength(11);
  expect(rows[0]).toMatchObject({ valorPrevisto: 3000, origemBaixa: 'MANUAL', guiaId: 'g1' });
  expect(rows.slice(1).every(p => p.valorPrevisto === 700)).toBe(true);
  expect(rows[1].vencimento.toISOString()).toBe('2026-11-20T12:00:00.000Z');
  expect(db.parcela.create).toHaveBeenCalledTimes(10);
  expect(db.parcela.update).not.toHaveBeenCalled();
});
test.each([rows => rows.slice(1), rows => [{ ...rows[0], valorPrevisto: -10 }, ...rows.slice(1)], rows => [{ ...rows[0], vencimento: '2026-02-30' }, ...rows.slice(1)]])('recusa cronograma inválido no contrato', alterar => {
  expect(() => buildDTOsFromManual({ header: { quantidadeParcelas: 11, cronogramaParcelas: alterar(cronograma()) } })).toThrow(/cronograma/);
});
