import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';

let mockPg;
const mockEffects = [];
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: new Proxy({}, {
  get(_target, key) {
    if (key === 'guide') return new Proxy({}, { get(_model, operation) {
      return (...args) => { mockEffects.push(`guide.${String(operation)}`); return mockPg.guide[operation](...args); };
    } });
    if (key === '$transaction') return (...args) => { mockEffects.push('transaction'); return mockPg.$transaction(...args); };
    const value = mockPg[key];
    return typeof value === 'function' ? value.bind(mockPg) : value;
  },
}) }));
jest.mock('../../../application/guides/GuideCompanyEmailService.js', () => ({
  sendCompanyGuidesEmail: jest.fn(async () => ({ ok: true, status: 'fixture_only' })),
}));
import { sendCompanyGuidesEmail } from '../../../application/guides/GuideCompanyEmailService.js';
import { liberarGuiasCliente, revogarLiberacaoCliente } from '../../../application/guides/GuideLiberacaoService.js';
import { requireAuth } from '../../../middlewares/requireAuth.js';
import { requireAccountType } from '../../../middlewares/requireAccountType.js';
import { autorizarEmpresasLiberacaoGuias } from '../autorizarEmpresasLiberacaoGuias.js';

const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
function appFor(user) {
  const app = express();
  app.use(express.json());
  // Session resolution is a fixture; auth/account-type/company authorization are real.
  app.locals.ensureAuthorized = async (req, res) => {
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return false; }
    req.auth = { user }; return true;
  };
  app.use(requireAuth(), requireAccountType('FIRM'));
  for (const route of ['/guides/liberar-cliente', '/guides/revogar-cliente']) {
    const start = source.indexOf(`router.post("${route}"`);
    if (start < 0) throw Error('Registro real da rota não encontrado.');
    const end = source.indexOf('\n  });', start) + '\n  });'.length;
    const register = new Function('router', 'requireAccountType', 'autorizarEmpresasLiberacaoGuias',
      'liberarGuiasCliente', 'revogarLiberacaoCliente', 'log', source.slice(start, end));
    register(app, requireAccountType, autorizarEmpresasLiberacaoGuias, liberarGuiasCliente, revogarLiberacaoCliente, { error() {} });
  }
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.code || 'fixture_error' }));
  return app;
}

const run = process.env.ALTAN_TESTE_POSTGRES === '1' ? test : test.skip;
run.each(['liberar', 'revogar'])('PostgreSQL HTTP %s: vínculo persistido, lote negado sem efeitos e isolamento', async operation => {
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
      || url.pathname !== '/altan_piloto_governance_test' || url.search) throw Error('Exige banco PostgreSQL sintético do piloto.');
  mockPg = new PrismaClient({ datasources: { db: { url: url.href } } });
  const suffix = randomUUID();
  try {
    const user = await mockPg.user.create({ data: { email: `${suffix}@example.test`, passwordHash: 'fixture-no-login', role: 'contador', accountType: 'FIRM', status: 'active' } });
    const a = await mockPg.portalClient.create({ data: { cnpj: `a-${suffix}`, razao: 'ACL SINTETICA A' } });
    const b = await mockPg.portalClient.create({ data: { cnpj: `b-${suffix}`, razao: 'ACL SINTETICA B' } });
    const link = await mockPg.companyFirmAccess.create({ data: { companyId: a.id, userId: user.id, role: 'ACCOUNTANT', status: 'ACTIVE' } });
    const initialReleased = operation === 'revogar';
    const common = { competencia: '2026-10', tipo: 'SIMPLES', status: 'PROCESSED', liberadaCliente: initialReleased, hash: suffix };
    const guideA = await mockPg.guide.create({ data: { ...common, portalClientId: a.id } });
    const guideB = await mockPg.guide.create({ data: { ...common, hash: `b-${suffix}`, portalClientId: b.id } });
    const before = await mockPg.guide.findMany({ where: { id: { in: [guideA.id, guideB.id] } }, orderBy: { id: 'asc' } });
    const app = appFor(user);
    const item = id => ({ portalClientId: id, competencia: '2026-10' });
    const route = `/guides/${operation}-cliente`;
    const deny = async (items, expected = 'forbidden') => {
      mockEffects.length = 0; sendCompanyGuidesEmail.mockClear();
      await request(app).post(route).send({ items, companyId: a.id, permitidas: [b.id] }).expect(403, { error: expected });
      expect(mockEffects).toEqual([]);
      expect(sendCompanyGuidesEmail).not.toHaveBeenCalled();
      expect(await mockPg.guide.findMany({ where: { id: { in: [guideA.id, guideB.id] } }, orderBy: { id: 'asc' } })).toEqual(before);
    };
    await deny([item(b.id)]);
    await deny([item(a.id), item(b.id)]);
    await deny([item(randomUUID())]);
    for (const status of ['REMOVED', 'INACTIVE']) {
      await mockPg.companyFirmAccess.update({ where: { id: link.id }, data: { status } });
      await deny([item(a.id)]);
    }
    await mockPg.companyFirmAccess.update({ where: { id: link.id }, data: { status: 'ACTIVE', role: 'STAFF' } });
    await deny([item(a.id)], 'insufficient_role');
    await mockPg.companyFirmAccess.update({ where: { id: link.id }, data: { role: 'ACCOUNTANT' } });
    mockEffects.length = 0; sendCompanyGuidesEmail.mockClear();
    const response = await request(app).post(route).send({ items: [item(a.id)] }).expect(200);
    expect(response.body).toMatchObject({ ok: true, total: 1, results: [{ portalClientId: a.id, competencia: '2026-10', ok: true, [operation === 'liberar' ? 'liberadas' : 'revogadas']: 1 }] });
    expect((await mockPg.guide.findUnique({ where: { id: guideA.id } })).liberadaCliente).toBe(!initialReleased);
    expect(await mockPg.guide.findUnique({ where: { id: guideB.id } })).toEqual(before.find(g => g.id === guideB.id));
    expect(sendCompanyGuidesEmail).toHaveBeenCalledTimes(operation === 'liberar' ? 1 : 0);
    if (operation === 'liberar') {
      expect(mockEffects).toContain('transaction');
      expect(sendCompanyGuidesEmail).toHaveBeenCalledWith({ portalClientId: a.id, competencia: '2026-10' });
    }
  } finally { await mockPg.$disconnect(); }
});
