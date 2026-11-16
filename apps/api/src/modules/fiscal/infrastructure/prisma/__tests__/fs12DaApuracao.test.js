import { criarPersistenciaFs12 } from '../fs12DaApuracao.js';
test('read transaction uses RepeatableRead and no write capability is invoked', async () => {
  const db = { $transaction: jest.fn(async fn => fn({})) };
  expect(await criarPersistenciaFs12(db).transacionar(async p => p.hash({ b: 2, a: 1 }), { escrita: false }))
    .toBe(await criarPersistenciaFs12(db).transacionar(async p => p.hash({ a: 1, b: 2 }), { escrita: false }));
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
});
test('serialization retries are bounded; unrelated errors are not retried', async () => {
  const db = { $transaction: jest.fn().mockRejectedValue({ code: 'P2034' }) };
  await expect(criarPersistenciaFs12(db).transacionar(jest.fn(), { escrita: true })).rejects.toMatchObject({ status: 409 });
  expect(db.$transaction).toHaveBeenCalledTimes(3);
  db.$transaction.mockReset().mockRejectedValue(Error('disk failure'));
  await expect(criarPersistenciaFs12(db).transacionar(jest.fn(), { escrita: true })).rejects.toThrow('disk failure');
  expect(db.$transaction).toHaveBeenCalledTimes(1);
});
