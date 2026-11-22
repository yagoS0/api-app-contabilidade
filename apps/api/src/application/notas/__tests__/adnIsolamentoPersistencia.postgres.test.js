// PostgreSQL descartável explícito; fixtures próprias, repetíveis. Não usa DATABASE_URL/dotenv.
jest.mock('../../../infrastructure/db/prisma.js', () => {
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
jest.mock('../../../config.js', () => ({ log: { warn: jest.fn() } }));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { upsertNfseFromItem } from '../ingestaoNfse.js';
import { randomUUID, randomInt } from 'node:crypto';
import { assertDisposablePostgres } from '../../../test-support/disposablePostgresGuard.js';

const pg = process.env.ALTAN_ADN_TESTE_POSTGRES16 === '1' ? describe : describe.skip;
pg('Persistência moderna ADN isolada', () => {
const tag = randomUUID();
const A = String(70000000000000 + randomInt(1000000000000));
const B = String(80000000000000 + randomInt(1000000000000));
let ready = false;
beforeAll(async () => {
  const [actual] = await prisma.$queryRaw`SELECT current_database() AS name, current_user AS username,
    host(inet_server_addr()) AS address, inet_server_port() AS port,
    current_setting('server_version_num') AS "versionNumber"`;
  assertDisposablePostgres({ raw: process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL, actual });
  if (Number(actual.versionNumber) < 160000 || Number(actual.versionNumber) >= 170000) throw Error('PostgreSQL16 obrigatório');
  ready = true;
});

test('destino e documento alheio/inconclusivo recusados sem escrita PostgreSQL', async () => {
  await prisma.portalClient.create({ data: { id: tag, razao: 'Fixture', cnpj: B } });
  const before = await prisma.portalInvoice.count({ where: { clientId: tag } });
  const opts = { portalClientId: tag, companyCnpj: A, metadata: { numeroNfse: '1', cnpjPrestador: A }, xmlPlain: '<fixture/>' };
  await expect(prisma.$transaction(tx => upsertNfseFromItem(tx, opts))).rejects.toMatchObject({ code: 'ADN_DESTINO_DOCUMENTAL_DIVERGENTE' });
  await expect(prisma.$transaction(tx => upsertNfseFromItem(tx, { ...opts, metadata: { numeroNfse: '1' } })))
    .rejects.toMatchObject({ code: 'ADN_VINCULO_DOCUMENTAL_INCONCLUSIVO' });
  const result = await prisma.$transaction(tx => upsertNfseFromItem(tx, { ...opts, metadata: { numeroNfse: '1', cnpjPrestador: B } }));
  expect(result.status).toBe('rejeitada_outro_cnpj');
  expect(await prisma.portalInvoice.count({ where: { clientId: tag } })).toBe(before);
});
afterAll(async () => {
  if (ready) {
    await prisma.portalInvoice.deleteMany({ where: { clientId: tag } });
    await prisma.portalClient.deleteMany({ where: { id: tag } });
  }
  await prisma.$disconnect();
});
});

