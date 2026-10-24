import { validarPedidoRecuperacao, consultarPendenciaSync } from '../RecuperacaoDocumentoSyncService.js';
import { hashCanonico } from '../ProcessadorDocumentoSyncLocal.js';
const pedido = { revisao: '1:2026-10-23T00:00:00.000Z', hash: 'a'.repeat(64), idempotencyKey: 'key_123456', motivo: 'Conferência local' };
test.each(['xml', 'override', 'actorId', 'companyId', 'chaveAcesso'])('rejects injected %s', key => {
  expect(() => validarPedidoRecuperacao({ ...pedido, [key]: 'injected' })).toThrow('INPUT_INVALIDO');
});
test.each([{ motivo: '' }, { revisao: 1 }, { hash: 'bad' }, { idempotencyKey: '' }, { motivo: 'x'.repeat(1001) }])('strict input %j', patch => {
  expect(() => validarPedidoRecuperacao({ ...pedido, ...patch })).toThrow('INPUT_INVALIDO');
});
test('legacy GET deterministic, scoped, redacted and strictly read only', async () => {
  const snapshot = { clientId: 'a', item: { NSU: '17', ArquivoXml: 'secret' }, origem: 'ADN_SYNC', cursor: '10', motivo: 'P1001' };
  const state = { clientId: 'a', updatedAt: new Date('2026-10-23T00:00:00Z'), documentoRecusado: snapshot };
  const db = { portalClient: { findUnique: async () => ({ id: 'a' }) }, portalSyncState: { findUnique: async () => state },
    syncDocumentoPendente: { findFirst: async () => null } };
  const first = await consultarPendenciaSync(db, { clientId: 'a' });
  expect(first).toEqual(await consultarPendenciaSync(db, { clientId: 'a' }));
  expect(first).toMatchObject({ hash: hashCanonico(snapshot), legado: true, nsu: '17', classe: 'TRANSITORIA' });
  expect(JSON.stringify(first)).not.toContain('secret');
  state.clientId = 'b';
  expect((await consultarPendenciaSync(db, { clientId: 'b' })).id).not.toBe(first.id);
});
