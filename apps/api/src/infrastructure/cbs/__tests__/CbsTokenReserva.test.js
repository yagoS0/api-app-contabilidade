import { criarReservaEmissaoCbs } from '../CbsTokenReserva.js';
const fixture = (quantidade = 0) => {
  const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ agora: new Date('2026-10-12T12:00:00Z') }]), apuracaoCbsTokenEmissao: { count: jest.fn(async () => quantidade), create: jest.fn(async () => ({})) } };
  const db = { $transaction: jest.fn(async f => f(tx)) }; return { tx, db, reservar: criarReservaEmissaoCbs(db) };
};
const args = { credencialId: 'cofre-1', janelaMs: 3600000, limite: 2 };
test('reserva serializable com lock e relógio DB, sem payload secreto', async () => {
  const f = fixture(); expect(await f.reservar({ ...args, agora: 0 })).toBe(true); expect(f.db.$transaction.mock.calls[0][1].isolationLevel).toBe('Serializable');
  expect(f.tx.$queryRaw.mock.calls[0][1]).toBe('CBS_OAUTH:cofre-1'); expect(f.tx.apuracaoCbsTokenEmissao.count).toHaveBeenCalledWith({ where: { credencialId: 'cofre-1', createdAt: { gte: new Date('2026-10-12T11:00:00Z') } } });
  expect(f.tx.apuracaoCbsTokenEmissao.create).toHaveBeenCalledWith({ data: { credencialId: 'cofre-1', createdAt: new Date('2026-10-12T12:00:00Z') } });
});
test('terceira emissão recusada sem insert', async () => { const f = fixture(2); expect(await f.reservar(args)).toBe(false); expect(f.tx.apuracaoCbsTokenEmissao.create).not.toHaveBeenCalled(); });
test('conflito concorrente nunca repetido e erro sanitizado', async () => { const db = { $transaction: jest.fn(async () => { throw new Error('prisma secret'); }) }; await expect(criarReservaEmissaoCbs(db)(args)).rejects.toMatchObject({ code: 'CBS_OAUTH_RESERVA_INDISPONIVEL' }); expect(db.$transaction).toHaveBeenCalledTimes(1); });
test.each([{ limite: 3 },{ janelaMs: 1 },{ credencialId: '' }])('limite não pode ser relaxado %#', async extras => { const f = fixture(); await expect(f.reservar({ ...args, ...extras })).rejects.toThrow(); expect(f.db.$transaction).not.toHaveBeenCalled(); });
