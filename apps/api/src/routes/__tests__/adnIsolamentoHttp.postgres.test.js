// PostgreSQL descartável explícito; fixtures próprias, repetíveis. Não usa DATABASE_URL/dotenv.
jest.mock('../../infrastructure/db/prisma.js', () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (process.env.ALTAN_ADN_TESTE_POSTGRES16 !== '1') return { prisma: {} };
  if (!raw) throw Error('URL explícita obrigatória para o ensaio ADN PostgreSQL16');
  const url = new URL(raw);
  if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) throw Error('Banco descartável loopback obrigatório');
  const { PrismaClient } = require('@prisma/client');
  return { prisma: new PrismaClient({ datasources: { db: { url: raw } } }) };
});
jest.mock('../../application/nfse/AdnSyncService.js', () => ({ AdnSyncService: { syncUntilEmpty: jest.fn(() => { throw Error('Provedor proibido'); }) } }));
import { prisma } from '../../infrastructure/db/prisma.js';
import { createAdnRouter } from '../adn.js';
import { AdnSyncService } from '../../application/nfse/AdnSyncService.js';
import express from 'express';
import request from 'supertest';
import { randomUUID, randomInt, randomBytes } from 'node:crypto';
import { assertDisposablePostgres } from '../../test-support/disposablePostgresGuard.js';

const pg = process.env.ALTAN_ADN_TESTE_POSTGRES16 === '1' ? describe : describe.skip;
pg('HTTP ADN com isolamento PostgreSQL', () => {
const tag = randomUUID(), owner = `owner-${tag}`, other = `other-${tag}`;
const A = String(70000000000000 + randomInt(1000000000000));
const B = String(80000000000000 + randomInt(1000000000000));
const docs = ['z', 'y', 'x'].map((suffix, i) => ({ id: `${tag}-${suffix}`,
  nsu: BigInt('0x' + randomBytes(6).toString('hex')),
  cnpjPrestador: i === 1 ? B : A, updatedAt: new Date('2026-11-20T00:00:00Z'), xmlPlain: `<fixture>${suffix}</fixture>` }));
let ready = false;
beforeAll(async () => {
  const [actual] = await prisma.$queryRaw`SELECT current_database() AS name, current_user AS username,
    host(inet_server_addr()) AS address, inet_server_port() AS port,
    current_setting('server_version_num') AS "versionNumber"`;
  assertDisposablePostgres({ raw: process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL, actual });
  if (Number(actual.versionNumber) < 160000 || Number(actual.versionNumber) >= 170000) throw Error('PostgreSQL16 obrigatório');
  ready = true;
});

// Sessão sintética injetada na porta de autenticação; ACL, rota, Prisma e HTTP reais.
// Não comprova login/JWT do servidor completo.
test('HTTP: acesso real por empresa, cursor alheio, 401/403 e zero escrita', async () => {
  await prisma.client.createMany({ data: [owner, other].map(id => ({ id, name: 'Fixture', email: `${id}@example.invalid`, login: id, passwordHash: 'fixture' })) });
  await prisma.company.createMany({ data: [[owner, A], [other, B]].map(([id, cnpj]) => ({ id: `company-${id}`, clientId: id, cnpj, razaoSocial: 'Fixture', atividades: [] })) });
  await prisma.adnDocument.createMany({ data: docs });
  const ensureAuthorized = async (req, res, options) => {
    expect(options).toEqual({ allowApiKeyFallback: false });
    if (req.get('x-fixture-session') !== owner) { res.status(401).json({ error: 'unauthorized' }); return false; }
    req.auth = { user: { id: owner, role: 'client' } }; return true;
  };
  const app = express(); app.use('/adn', createAdnRouter({ ensureAuthorized, log: { error: jest.fn() } }));
  const fixtureWhere = { id: { in: docs.map(doc => doc.id) } };
  const before = await prisma.adnDocument.findMany({ where: fixtureWhere, orderBy: { id: 'asc' } });
  const read = jest.spyOn(prisma.adnDocument, 'findMany');
  await request(app).get('/adn/notas').query({ cnpj: A }).expect(401);
  await request(app).get('/adn/notas').set('x-fixture-session', owner).query({ cnpj: B }).expect(403);
  expect(read).not.toHaveBeenCalled();
  read.mockRestore();
  const first = await request(app).get('/adn/notas').set('x-fixture-session', owner).query({ cnpj: A, limit: 1 }).expect(200);
  expect(first.body.items.map(x => x.id)).toEqual([docs[0].id]);
  const next = await request(app).get('/adn/notas').set('x-fixture-session', owner).query({ cnpj: A, cursor: first.body.nextCursor }).expect(200);
  expect(next.body.items.map(x => x.id)).toEqual([docs[2].id]);
  await request(app).get('/adn/notas').set('x-fixture-session', owner).query({ cnpj: A, direcao: 'bad' }).expect(400);
  const byId = await request(app).get('/adn/notas').set('x-fixture-session', owner).query({ companyId: `company-${owner}` }).expect(200);
  expect(byId.body.items.map(x => x.id)).toEqual([docs[0].id, docs[2].id]);
  await request(app).get('/adn/notas').set('x-fixture-session', owner).query({ companyId: `company-${other}` }).expect(403);
  expect(await prisma.adnDocument.findMany({ where: fixtureWhere, orderBy: { id: 'asc' } })).toEqual(before);
  expect(AdnSyncService.syncUntilEmpty).not.toHaveBeenCalled();
});
afterAll(async () => {
  jest.restoreAllMocks();
  if (ready) {
    await prisma.adnDocument.deleteMany({ where: { id: { in: docs.map(doc => doc.id) } } });
    await prisma.company.deleteMany({ where: { id: { in: [`company-${owner}`, `company-${other}`] } } });
    await prisma.client.deleteMany({ where: { id: { in: [owner, other] } } });
  }
  await prisma.$disconnect();
});
});

