jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { createSolicitacoesRouter } from '../solicitacoes.js';

// Invoke the real Express route with a real service and a local transaction client.
// No listener, network, singleton database or mocked service.
function fixture() {
  const write = jest.fn(() => { throw new Error('Unexpected write'); });
  const tx = {
    user: {
      findUnique: jest.fn(async () => ({ id: 'actor', accountType: 'FIRM', role: 'contador', status: 'active' })),
      findMany: jest.fn(async args => {
        expect(args.select).toEqual({ id: true, name: true });
        expect(args.where.AND[0].AND[1].OR[1].companyFirmAccess.some.companyId).toBe('pc1');
        return [{ id: 'u1', name: null }, { id: 'u2', name: 'Ana' }].slice(0, args.take);
      }), update: write, create: write,
    },
    portalClient: { findMany: async () => [{ id: 'pc1' }] },
    encaminhamentoSuporte: {
      fields: {},
      findMany: async () => [{ id: 's1', portalClientId: 'pc1', contratoVersao: 1, mensagens: [] }],
      findFirst: async ({ where }) => where.AND[0].id === 's1' ? { id: 's1', portalClientId: 'pc1' } : null,
      update: write, create: write,
    },
  };
  const client = { $transaction: jest.fn(fn => fn(tx)) };
  const router = createSolicitacoesRouter({ client });
  const route = router.stack.find(layer => layer.route?.path === '/solicitacoes/:id/responsaveis').route;
  const call = async (query = {}, auth = { user: { id: 'actor' } }, id = 's1') => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await route.stack[0].handle({ query, auth, params: { id } }, res);
    return res;
  };
  return { call, tx, client, write, route };
}

test('GET uses authenticated actor, returns only stable IDs/names and performs no writes', async () => {
  const f = fixture(); const res = await f.call();
  expect(f.route.methods).toEqual({ get: true });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, itens: [{ id: 'u1', nome: null }, { id: 'u2', nome: 'Ana' }], proximoCursor: null });
  expect(f.tx.user.findUnique).toHaveBeenCalledWith({ where: { id: 'actor' } });
  expect(f.client.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  expect(f.write).not.toHaveBeenCalled();
});

test.each([
  { limite: ['1', '2'] }, { busca: ['a', 'b'] }, { cursor: ['a', 'b'] },
  { busca: { contains: 'a' } }, { limite: '1.5' }, { limite: '101' }, { limite: '0' },
  { limite: '01' }, { busca: '\u0000' }, { busca: 'a'.repeat(201) },
  { atorId: 'other' }, { companyId: 'pc2' }, { portalClientId: 'pc2' },
  { cursor: 'x'.repeat(2000) }, { cursor: '' },
])('rejects extra, duplicate or malformed query: %j', async query => {
  const f = fixture(); const res = await f.call(query);
  expect(res.statusCode).toBe(400); expect(res.body.ok).toBe(false);
  expect(f.tx.user.findMany).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});

test('no session and out-of-scope item reveal no directory identity', async () => {
  const f = fixture(); const noSession = await f.call({}, null);
  expect(noSession.statusCode).toBe(401); expect(f.client.$transaction).not.toHaveBeenCalled();
  const missing = await f.call({}, { user: { id: 'actor' } }, 'other-company-item');
  expect(missing.statusCode).toBe(404);
  expect(missing.body).toEqual({ ok: false, code: 'solicitacao_nao_encontrada', error: 'solicitacao_nao_encontrada', motivo: 'solicitacao_nao_encontrada' });
  expect(f.tx.user.findMany).not.toHaveBeenCalled();
});

test('valid empty list differs from database error and inactive actor', async () => {
  const f = fixture(); f.tx.user.findMany.mockResolvedValueOnce([]);
  expect((await f.call()).body).toEqual({ ok: true, itens: [], proximoCursor: null });
  f.tx.user.findMany.mockRejectedValueOnce(new Error('private database information'));
  const failure = await f.call(); expect(failure.statusCode).toBe(500);
  expect(failure.body).toEqual({ ok: false, code: 'solicitacao_indisponivel', error: 'solicitacao_indisponivel', motivo: 'solicitacao_indisponivel' });
  f.tx.user.findUnique.mockResolvedValueOnce({ id: 'actor', accountType: 'FIRM', role: 'admin', status: 'inactive' });
  expect((await f.call()).statusCode).toBe(403);
});

test('page/search parameters reach the database and malformed cursor returns 400', async () => {
  const f = fixture(); const page = await f.call({ busca: ' Ana ', limite: '1' });
  expect(page.body.itens).toHaveLength(1); expect(typeof page.body.proximoCursor).toBe('string');
  expect(f.tx.user.findMany.mock.calls[0][0]).toMatchObject({ where: { AND: expect.arrayContaining([{ name: { contains: 'Ana', mode: 'insensitive' } }]) }, take: 2, orderBy: { id: 'asc' } });
  const invalid = await f.call({ cursor: 'invalid!' });
  expect(invalid.statusCode).toBe(400); expect(invalid.body.code).toBe('cursor_invalido');
});
