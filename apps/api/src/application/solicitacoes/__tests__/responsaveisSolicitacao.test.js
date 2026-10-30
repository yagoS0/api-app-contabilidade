import { SolicitacoesService } from '../SolicitacoesService.js';
import { interno, gestor, validarVinculos } from '../solicitacoesPolicy.js';
import { versao } from '../solicitacoesProjection.js';

// Evaluate the structured query BEFORE take/select; unknown operators fail loudly.
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(w => matches(row, w));
    if (key === 'OR') return value.some(w => matches(row, w));
    if (value === null || typeof value !== 'object') return row[key] === value;
    return Object.entries(value).every(([op, arg]) => {
      if (op === 'in') return arg.includes(row[key]);
      if (op === 'gt') return row[key] > arg;
      if (op === 'some') return row[key].some(r => matches(r, arg));
      if (op === 'is') return row[key] && matches(row[key], arg);
      if (op === 'mode') { expect(arg).toBe('insensitive'); return true; }
      if (op === 'contains') return typeof row[key] === 'string' && row[key].toLowerCase().includes(arg.toLowerCase());
      throw new Error(`Unexpected operator ${op}`);
    });
  });
}
const user = (id, extra = {}) => ({ id, name: 'Ana', status: 'active', accountType: 'FIRM', role: 'staff', companyFirmAccess: [], email: 'private@example.invalid', ...extra });
const access = (extra = {}) => ({ companyId: 'pc1', status: 'ACTIVE', role: 'STAFF', ...extra });
function fixture() {
  const users = [user('actor', { role: 'contador' })];
  const rows = [{ id: 's1', portalClientId: 'pc1', contratoVersao: 1, revisao: 1, estado: 'AGUARDANDO', conversaId: null, mensagens: [], updatedAt: new Date('2026-10-28T12:00:00Z') }];
  const write = jest.fn(() => { throw new Error('Unexpected write'); });
  const tx = {
    user: {
      findUnique: jest.fn(async ({ where }) => users.find(u => u.id === where.id)),
      findMany: jest.fn(async ({ where, orderBy, take, select }) => {
        expect(orderBy).toEqual({ id: 'asc' }); expect(select).toEqual({ id: true, name: true });
        return users.filter(u => matches(u, where)).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, take).map(u => ({ id: u.id, name: u.name }));
      }),
    },
    portalClient: { findMany: async () => [{ id: 'pc1' }, { id: 'pc2' }] },
    companyFirmAccess: {
      findMany: async ({ where }) => users.find(u => u.id === where.userId).companyFirmAccess.filter(a => a.status === 'ACTIVE' && ['STAFF', 'ACCOUNTANT', 'FIRM_ADMIN'].includes(a.role)),
      findUnique: async ({ where }) => users.find(u => u.id === where.companyId_userId.userId)?.companyFirmAccess.find(a => a.companyId === where.companyId_userId.companyId),
    },
    encaminhamentoSuporte: {
      fields: {}, findMany: async ({ where }) => rows.filter(r => matches(r, where)),
      findFirst: async ({ where }) => rows.find(r => matches(r, where)), updateMany: write, create: write,
    },
    solicitacaoComando: { findUnique: async () => null, create: write },
    solicitacaoEvento: { create: write },
  };
  const client = { $transaction: jest.fn(fn => fn(tx)) };
  const service = new SolicitacoesService({ client });
  const contexto = { canal: 'INTERNO', atorId: 'actor' };
  const list = (query = {}, id = 's1', ctx = contexto) => service.listarResponsaveis({ contexto: ctx, id, query });
  return { users, rows, tx, client, service, contexto, list, write };
}

test('structured eligibility agrees with current assignment policy across roles, status, type and memberships', async () => {
  const f = fixture();
  for (const status of ['active', 'inactive']) for (const accountType of ['FIRM', 'CLIENT'])
    for (const role of ['admin', 'contador', 'staff']) for (const membership of [[], [access()], [access({ status: 'REMOVED' })], [access({ role: 'CLIENT_ADMIN' })], [access({ companyId: 'company1' })], [access({ role: 'ACCOUNTANT' })], [access({ role: 'FIRM_ADMIN' })]])
      f.users.push(user(`u${String(f.users.length).padStart(4, '0')}`, { status, accountType, role, companyFirmAccess: membership }));
  const got = [];
  let cursor;
  do { const page = await f.list({ limite: '100', ...(cursor ? { cursor } : {}) }); got.push(...page.itens.map(u => u.id)); cursor = page.proximoCursor; } while (cursor);
  const expected = [];
  for (const u of f.users) {
    try { await validarVinculos(f.tx, { empresas: ['pc1'] }, { portalClientId: 'pc1', responsavelId: u.id }); expected.push(u.id); } catch { /* rejected by existing write policy */ }
  }
  expect(got).toEqual(expected.sort()); expect(f.write).not.toHaveBeenCalled();
  expect(f.tx.user.findMany.mock.calls[0][0].where.AND[0]).toEqual({ AND: [
    { status: 'active', OR: [{ accountType: 'FIRM' }, { role: 'admin' }] },
    { OR: [{ role: { in: ['admin', 'contador'] } }, { companyFirmAccess: { some: { companyId: 'pc1', status: 'ACTIVE', role: { in: ['STAFF', 'ACCOUNTANT', 'FIRM_ADMIN'] } } } }] },
  ] });
});

test('more than 100 candidates, homonyms, missing names, name-only search and deterministic pages', async () => {
  const f = fixture();
  for (let i = 0; i < 115; i++) f.users.push(user(`u${String(i).padStart(3, '0')}`, { name: i === 0 ? null : i === 1 ? '  ' : 'Ana', companyFirmAccess: [access()] }));
  const first = await f.list({ limite: '100' }); const second = await f.list({ limite: '100', cursor: first.proximoCursor });
  expect(first.itens).toHaveLength(100); expect(second.itens).toHaveLength(16); expect(second.proximoCursor).toBeNull();
  expect(new Set([...first.itens, ...second.itens].map(u => u.id)).size).toBe(116);
  expect(first.itens.filter(u => u.nome === null)).toHaveLength(2);
  expect(first.itens.every(u => Object.keys(u).sort().join(',') === 'id,nome')).toBe(true);
  expect((await f.list({ busca: '  aNA  ', limite: '100' })).itens).toHaveLength(100);
  expect(await f.list({ busca: 'private@example.invalid' })).toEqual({ itens: [], proximoCursor: null });
  expect((await f.list()).itens).toHaveLength(50);
  expect(await f.list({ busca: ' ' })).toEqual(await f.list());
});

test('triage only lists managers; legacy resolves effective PortalClient before querying users', async () => {
  const f = fixture(); f.users.push(user('staff', { companyFirmAccess: [access()] }));
  f.rows[0].portalClientId = null;
  expect((await f.list()).itens.map(u => u.id)).toEqual(f.users.filter(u => interno(u) && gestor(u)).map(u => u.id));
  Object.assign(f.rows[0], { contratoVersao: null, conversaId: 'c1', conversa: { id: 'c1', portalClientId: 'pc1' } });
  expect((await f.list()).itens.map(u => u.id)).toEqual(['actor', 'staff']);
});

test('authorization precedes directory lookup, including forbidden WhatsApp segment and staff triage', async () => {
  for (const scenario of ['inactive', 'client', 'foreign', 'triage', 'segment']) {
    const f = fixture();
    Object.assign(f.users[0], { role: 'staff', companyFirmAccess: [access()] });
    if (scenario === 'inactive') f.users[0].status = 'inactive';
    if (scenario === 'client') f.users[0].accountType = 'CLIENT';
    if (scenario === 'foreign') f.rows[0].portalClientId = 'pc2';
    if (scenario === 'triage') f.rows[0].portalClientId = null;
    if (scenario === 'segment') Object.assign(f.rows[0], { conversaId: 'c1', conversa: { id: 'c1', portalClientId: 'pc1', excluidaEm: new Date() } });
    await expect(f.list()).rejects.toMatchObject({ status: ['inactive', 'client'].includes(scenario) ? 403 : 404 });
    expect(f.tx.user.findMany).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  }
});

test('cursor is bound to actor, item, filter, limit, current scope and effective company', async () => {
  for (const change of ['actor', 'item', 'filter', 'limit', 'scope', 'company']) {
    const f = fixture(); f.users.push(user('other', { role: 'contador' }));
    const { proximoCursor: cursor } = await f.list({ limite: '1' });
    const query = { limite: '1', cursor }; let id = 's1', ctx = f.contexto;
    if (change === 'actor') ctx = { ...ctx, atorId: 'other' };
    if (change === 'item') { f.rows.push({ ...f.rows[0], id: 's2' }); id = 's2'; }
    if (change === 'filter') query.busca = 'Ana';
    if (change === 'limit') query.limite = '2';
    if (change === 'scope') f.tx.portalClient.findMany = async () => [{ id: 'pc1' }];
    if (change === 'company') f.rows[0].portalClientId = 'pc2';
    f.tx.user.findMany.mockClear();
    await expect(f.list(query, id, ctx)).rejects.toMatchObject({ code: 'cursor_invalido', status: 400 });
    expect(f.tx.user.findMany).not.toHaveBeenCalled();
  }
});

test.each([{ limite: '101' }, { limite: '0' }, { limite: 1 }, { limite: '01' }, { busca: ['Ana'] }, { busca: '\nAna' }, { busca: 'a'.repeat(201) }, { companyId: 'pc1' }, { cursor: '' }, { cursor: 'a'.repeat(2000) }, { cursor: '%%%!' }, { cursor: 'bnVsbA' }, { cursor: 'e30' }])('rejects malformed closed query %j', async query => {
  const f = fixture(); await expect(f.list(query)).rejects.toMatchObject({ status: 400 }); expect(f.tx.user.findMany).not.toHaveBeenCalled();
});

test('revocation after listing remains rejected by existing edit, with zero writes', async () => {
  const f = fixture(); f.users.push(user('staff', { companyFirmAccess: [access()] }));
  expect((await f.list()).itens.some(u => u.id === 'staff')).toBe(true);
  f.users[1].companyFirmAccess = [];
  await expect(f.service.editar({ contexto: f.contexto, id: 's1', chave: 'k', versao: versao(f.rows[0]), dados: { responsavelId: 'staff' } })).rejects.toMatchObject({ code: 'responsavel_fora_escopo' });
  expect((await f.list()).itens.some(u => u.id === 'staff')).toBe(false);
  expect(f.write).not.toHaveBeenCalled();
});

test('every cursor page reauthorizes the item after membership revocation', async () => {
  const f = fixture();
  Object.assign(f.users[0], { role: 'staff', companyFirmAccess: [access()] });
  f.users.push(user('other', { companyFirmAccess: [access()] }));
  const page = await f.list({ limite: '1' });
  expect(page.proximoCursor).not.toBeNull();
  f.users[0].companyFirmAccess = [];
  f.tx.user.findMany.mockClear();
  await expect(f.list({ limite: '1', cursor: page.proximoCursor })).rejects.toMatchObject({ status: 404 });
  expect(f.tx.user.findMany).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});
