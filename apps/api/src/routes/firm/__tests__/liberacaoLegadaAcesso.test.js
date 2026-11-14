import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../../../middlewares/requireAuth.js';
import { requireAccountType } from '../../../middlewares/requireAccountType.js';
import { prisma } from '../../../infrastructure/db/prisma.js';

jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  companyFirmAccess: { findUnique: jest.fn() },
  guide: { findMany: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
} }));

// Executa os registros e handlers do arquivo de produção. Somente a resolução
// de sessão e os efeitos posteriores são doubles; a política ACL não é mockada.
const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const baseline = process.env.ALTAN_CARACTERIZAR_ACESSO_LEGADO === '1';
const paths = ['/guides/liberar-cliente', '/guides/revogar-cliente'];
const registros = paths.map(route => {
  const start = source.indexOf(`router.post("${route}"`);
  const end = source.indexOf('\n  });', start) + '\n  });'.length;
  if (start < 0 || end <= start) throw Error(`Handler real não encontrado: ${route}`);
  return source.slice(start, end);
}).join('\n');
const register = new Function('router', 'requireAccountType', 'liberarGuiasCliente',
  'revogarLiberacaoCliente', 'autorizarEmpresasLiberacaoGuias', 'log', registros);
const email = jest.fn();
const liberar = jest.fn();
const revogar = jest.fn();
const actor = { id: 'contador-a', role: 'contador', accountType: 'FIRM' };
const item = (company = 'A') => ({ portalClientId: company, competencia: '2026-10' });
let links;

function app(user = actor) {
  const a = express();
  a.use(express.json());
  a.locals.ensureAuthorized = async (req, res, options) => {
    expect(options).toEqual({ allowApiKeyFallback: false });
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return false; }
    req.auth = { user };
    return true;
  };
  expect(source).toContain('router.use(requireAuth(), requireAccountType("FIRM"))');
  a.use(requireAuth(), requireAccountType('FIRM'));
  const autorizar = baseline ? undefined
    : require('../autorizarEmpresasLiberacaoGuias.js').autorizarEmpresasLiberacaoGuias;
  register(a, requireAccountType, liberar, revogar, autorizar, { error: jest.fn() });
  a.use((error, _req, res, _next) => res.status(500).json({ error: 'erro_do_ensaio' }));
  return a;
}

beforeEach(() => {
  jest.resetAllMocks();
  links = new Map([['A', { role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] }]]);
  prisma.companyFirmAccess.findUnique.mockImplementation(async ({ where, select }) => {
    expect(select).toEqual({ role: true, status: true, scopes: true });
    expect(where.companyId_userId.userId).toBe(actor.id);
    return links.get(where.companyId_userId.companyId) || null;
  });
  prisma.guide.findMany.mockResolvedValue([]);
  prisma.guide.updateMany.mockResolvedValue({ count: 1 });
  prisma.$transaction.mockImplementation(async fn => fn(prisma));
  liberar.mockImplementation(async input => {
    await prisma.guide.findMany({ where: { portalClientId: input.portalClientId } });
    await prisma.$transaction(tx => tx.guide.updateMany({ where: { portalClientId: input.portalClientId } }));
    await email(input);
    return { liberadas: 1, emailResult: { ok: true } };
  });
  revogar.mockImplementation(async input => {
    await prisma.guide.updateMany({ where: { portalClientId: input.portalClientId } });
    return { revogadas: 1 };
  });
});

function semEfeito() {
  expect(liberar).not.toHaveBeenCalled();
  expect(revogar).not.toHaveBeenCalled();
  expect(prisma.guide.findMany).not.toHaveBeenCalled();
  expect(prisma.guide.updateMany).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(email).not.toHaveBeenCalled();
}

(baseline ? describe : describe.skip)('caracterização explícita da base vulnerável', () => {
  test.each(paths)('%s permite empresa sem vínculo antes da correção', async route => {
    expect(registros).not.toContain('autorizarEmpresasLiberacaoGuias');
    await request(app()).post(route).send({ items: [item('SEM-VINCULO')] }).expect(200);
    expect(prisma.companyFirmAccess.findUnique).not.toHaveBeenCalled();
    expect(route.includes('revogar') ? revogar : liberar).toHaveBeenCalledTimes(1);
  });
});

(baseline ? describe.skip : describe)('liberação legada com política canônica real', () => {
  describe.each(paths)('%s', route => {
    test('autoriza vínculo ativo e conserva envelope e ator do servidor', async () => {
      const r = await request(app()).post(route).send({ items: [item(' A ')], userId: 'forjado' }).expect(200);
      expect(r.body).toMatchObject({ ok: true, total: 1, results: [{ portalClientId: 'A', competencia: '2026-10', ok: true }] });
      const service = route.includes('revogar') ? revogar : liberar;
      expect(service).toHaveBeenCalledWith(expect.objectContaining(item()));
      if (service === liberar) expect(service).toHaveBeenCalledWith({ ...item(), userId: actor.id });
      else expect(email).not.toHaveBeenCalled();
    });
    test.each([null, { role: 'ACCOUNTANT', status: 'INACTIVE' }, { role: 'ACCOUNTANT', status: 'REVOKED' }])('recusa vínculo ausente/inativo/revogado %j', async link => {
      links.set('A', link);
      await request(app()).post(route).send({ items: [item()] }).expect(403, { error: 'forbidden' });
      semEfeito();
    });
    test.each(['OUTRA', 'INEXISTENTE'])('recusa empresa %s sem consultar documentos', async company => {
      await request(app()).post(route).send({ items: [item(company)] }).expect(403, { error: 'forbidden' });
      semEfeito();
    });
    test('recusa papel insuficiente do vínculo', async () => {
      links.set('A', { role: 'STAFF', status: 'ACTIVE' });
      await request(app()).post(route).send({ items: [item()] }).expect(403, { error: 'insufficient_role' });
      semEfeito();
    });
    test('autoriza FIRM_ADMIN vinculado sem ampliar papel global', async () => {
      links.set('A', { role: 'FIRM_ADMIN', status: 'ACTIVE' });
      await request(app()).post(route).send({ items: [item()] }).expect(200);
      expect(prisma.companyFirmAccess.findUnique).toHaveBeenCalledTimes(1);
    });
    test('preserva admin global sem exigir vínculo', async () => {
      links.clear();
      await request(app({ ...actor, role: 'admin' })).post(route).send({ items: [item('OUTRA')] }).expect(200);
      expect(prisma.companyFirmAccess.findUnique).not.toHaveBeenCalled();
    });
    test('papel global insuficiente mantém erro anterior', async () => {
      await request(app({ ...actor, role: 'assistente' })).post(route).send({ items: [item()] })
        .expect(403, { error: 'forbidden_admin_or_contador_only' });
      semEfeito();
      expect(prisma.companyFirmAccess.findUnique).not.toHaveBeenCalled();
    });
    test('não autenticado não consulta ACL ou documento', async () => {
      await request(app(null)).post(route).send({ items: [item()] }).expect(401, { error: 'unauthorized' });
      semEfeito();
      expect(prisma.companyFirmAccess.findUnique).not.toHaveBeenCalled();
    });
    test('conta cliente não herda papel de contador', async () => {
      await request(app({ ...actor, accountType: 'CLIENT' })).post(route).send({ items: [item()] })
        .expect(403, { error: 'forbidden_account_type', expected: 'FIRM', received: 'CLIENT' });
      semEfeito();
    });
    test('lote misto recusa integralmente antes do primeiro efeito', async () => {
      await request(app()).post(route).send({ items: [item('A'), item('B')], companyId: 'A', permitidas: ['A', 'B'], access: { role: 'FIRM_ADMIN' } })
        .expect(403, { error: 'forbidden' });
      expect(prisma.companyFirmAccess.findUnique.mock.calls.map(([q]) => q.where.companyId_userId.companyId)).toEqual(['A', 'B']);
      semEfeito();
    });
    test('falha de leitura ACL não concede acesso', async () => {
      prisma.companyFirmAccess.findUnique.mockRejectedValue(new Error('ACL indisponível'));
      await request(app()).post(route).send({ items: [item()] }).expect(500);
      semEfeito();
    });
    test('preserva items_required e invalid_input sem autorizar itens incompletos', async () => {
      await request(app()).post(route).send({ items: [] }).expect(400, { ok: false, error: 'items_required' });
      await request(app()).post(route).send({ items: [{ portalClientId: 'A' }] }).expect(200, {
        ok: true, total: 1, results: [{ portalClientId: 'A', competencia: '', ok: false, error: 'invalid_input' }],
      });
      semEfeito();
      expect(prisma.companyFirmAccess.findUnique).not.toHaveBeenCalled();
    });
  });
});
