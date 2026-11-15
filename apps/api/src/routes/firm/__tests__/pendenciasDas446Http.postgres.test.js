// Dedicated PostgreSQL16 synthetic fixtures. No real authentication or external transport.
jest.mock('axios', () => ({ request: jest.fn(() => { throw Error('NETWORK_FORBIDDEN'); }), post: jest.fn(() => { throw Error('NETWORK_FORBIDDEN'); }) }));
jest.mock('../../../application/fiscal/serpro/SerproHttpClient.js', () => ({ SerproHttpClient: jest.fn(() => { throw Error('SERPRO_FORBIDDEN'); }) }));
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createOperationsRouter } from '../operacoes.js';
import { requireAuth } from '../../../middlewares/requireAuth.js';
import { requireAccountType } from '../../../middlewares/requireAccountType.js';
import { requireFirmCompanyAccess } from '../../../middlewares/requireFirmCompanyAccess.js';
import { SerproHttpClient } from '../../../application/fiscal/serpro/SerproHttpClient.js';
import axios from 'axios';
const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
const url = process.env.TEST_CICLO_PG_URL || process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
suite('4.4.6 HTTP with canonical authorization and PostgreSQL16', () => {
  let app, company, other, user, foreignUser, guide; const calls = [];
  beforeAll(async () => {
    const parsed = new URL(url);
    if (process.env.NODE_ENV !== 'test' || url !== process.env.DATABASE_URL || !['postgres:','postgresql:'].includes(parsed.protocol) || !['localhost','127.0.0.1'].includes(parsed.hostname) || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(parsed.pathname) || parsed.search || parsed.hash) throw Error('Disposable loopback PostgreSQL required');
    const [server] = await prisma.$queryRawUnsafe("SELECT current_setting('server_version_num') AS version");
    expect(Number(server.version)).toBeGreaterThanOrEqual(160000); expect(Number(server.version)).toBeLessThan(170000);
    company = randomUUID(); other = randomUUID(); user = randomUUID(); foreignUser = randomUUID();
    for (const id of [company, other]) await prisma.portalClient.create({ data: { id, cnpj: BigInt('0x' + id.replace(/-/g,'').slice(0,10)).toString().padStart(14,'0'), razao: 'SYNTHETIC446' } });
    for (const id of [user, foreignUser]) await prisma.user.create({ data: { id, email: `${id}@invalid.test`, passwordHash: 'synthetic', role: 'accountant', accountType: 'FIRM', status: 'active' } });
    await prisma.companyFirmAccess.create({ data: { companyId: company, userId: user, role: 'ACCOUNTANT', status: 'ACTIVE' } });
    await prisma.companyFirmAccess.create({ data: { companyId: other, userId: foreignUser, role: 'ACCOUNTANT', status: 'ACTIVE' } });
    guide = await prisma.guide.create({ data: { portalClientId: company, competencia: '2026-10', tipo: 'SIMPLES', source: 'LOCAL', sourceFileId: `synthetic:${randomUUID()}`, status: 'PROCESSED', valor: '100' } });
    // Middleware measures every Prisma model access during HTTP reads, including real ACL.
    prisma.$use(async (params, next) => { calls.push(`${params.model}.${params.action}`); return next(params); });
    app = express();
    app.locals.ensureAuthorized = async (req, res, options) => {
      expect(options.allowApiKeyFallback).toBe(false);
      if (!req.headers['x-synthetic-user']) { res.status(401).json({ error: 'unauthorized' }); return false; }
      req.auth = { user: { id: req.headers['x-synthetic-user'], role: req.headers['x-synthetic-role'] || 'accountant', accountType: req.headers['x-synthetic-account'] || 'FIRM' } };
      return true;
    };
    app.use('/firm', requireAuth(), requireAccountType('FIRM'), createOperationsRouter({ prisma, requireFirmCompanyAccess }));
  });
  afterAll(async () => { await prisma.$disconnect(); });
  const path = (id = company, period = '2026-10') => `/firm/companies/${id}/operacoes/${period}/pendencias-das`;
  test('authenticated linked company, different period, absent evidence and read-only contract', async () => {
    const before = JSON.stringify(await prisma.guide.findUnique({ where: { id: guide.id } })); calls.length = 0;
    const response = await request(app).get(path()).set('x-synthetic-user', user);
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.companyId).toBe(company); expect(response.body.fontes.find(f => f.id === 'guias').quantidade).toBe(1);
    expect(calls.every(action => ['findMany','findUnique'].includes(action.split('.').pop()))).toBe(true);
    const next = await request(app).get(path(company,'2026-11')).set('x-synthetic-user',user);
    expect(next.body.fontes.find(f => f.id === 'guias').quantidade).toBe(0);
    expect(JSON.stringify(await prisma.guide.findUnique({ where: { id: guide.id } }))).toBe(before);
    expect(SerproHttpClient).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
  });
  test('missing session, other company, other office membership and client account denied', async () => {
    expect((await request(app).get(path())).status).toBe(401);
    for (const [id, actor] of [[other,user],[company,foreignUser]]) {
      calls.length = 0; const response = await request(app).get(path(id)).set('x-synthetic-user',actor);
      expect(response.status).toBe(403); expect(response.body).not.toHaveProperty('achados'); expect(calls).toEqual(['CompanyFirmAccess.findUnique']);
    }
    expect((await request(app).get(path()).set('x-synthetic-user',user).set('x-synthetic-account','CLIENT')).status).toBe(403);
  });
  test('document filter cannot escape scope; no pagination or writing endpoint', async () => {
    const response = await request(app).get(path(other) + `?documentoId=${guide.id}`).set('x-synthetic-user',foreignUser);
    expect(response.status).toBe(200); expect(response.body.fontes.find(f => f.id === 'guias').quantidade).toBe(0);
    expect((await request(app).get(path() + '?page=2').set('x-synthetic-user',user)).status).toBe(400);
    expect((await request(app).post(path()).set('x-synthetic-user',user)).status).toBe(404);
  });
  test('inactive, removed and insufficient role denied before evidence; canonical admin exception remains', async () => {
    const where = { companyId_userId: { companyId: company, userId: user } };
    for (const data of [{ status: 'INACTIVE' }, { status: 'REMOVED' }, { status: 'ACTIVE', role: 'STAFF' }]) {
      await prisma.companyFirmAccess.update({ where, data }); calls.length = 0;
      const response = await request(app).get(path()).set('x-synthetic-user',user);
      expect(response.status).toBe(403); expect(calls).toEqual(['CompanyFirmAccess.findUnique']);
      expect(response.body).not.toHaveProperty('achados');
    }
    await prisma.companyFirmAccess.update({ where, data: { status: 'ACTIVE', role: 'ACCOUNTANT' } });
    const admin = await request(app).get(path()).set('x-synthetic-user',foreignUser).set('x-synthetic-role','admin');
    expect(admin.status).toBe(200); expect(admin.body.companyId).toBe(company);
  });

});
