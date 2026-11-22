// Somente PostgreSQL 16 descartável explícito; nunca usa DATABASE_URL/dotenv.
jest.mock('../prisma.js', () => {
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
import { prisma } from '../prisma.js';
import { PrismaClient } from '@prisma/client';
import { AdnRepository } from '../AdnRepository.js';
import { assertDisposablePostgres } from '../../../test-support/disposablePostgresGuard.js';
import { randomUUID, randomInt, randomBytes } from 'node:crypto';

const pg = process.env.ALTAN_ADN_TESTE_POSTGRES16 === '1' ? describe : describe.skip;
pg('ADN: isolamento real em PostgreSQL16', () => {
  const tag = randomUUID();
  const A = String(70000000000000 + randomInt(1000000000000));
  const B = String(80000000000000 + randomInt(1000000000000));
  const C = String(90000000000000 + randomInt(1000000000000));
  const ids = ['z', 'y', 'x', 'w'].map(s => tag + '-' + s);
  const nsuBase = BigInt('0x' + randomBytes(6).toString('hex'));
  const ownedIds = [...ids];
  let ready = false, second;
  const nextNsu = () => nsuBase + BigInt(ownedIds.length + 10);
  const fixture = async data => {
    const id = tag + '-' + randomUUID(), nsu = nextNsu();
    ownedIds.push(id);
    return prisma.adnDocument.create({ data: { id, nsu, cnpjPrestador: A, ...data } });
  };
  beforeAll(async () => {
    const [actual] = await prisma.$queryRawUnsafe("SELECT current_database() AS name, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port, current_setting('server_version_num') AS \"versionNumber\"");
    assertDisposablePostgres({ raw: process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL, actual });
    if (Number(actual.versionNumber) < 160000 || Number(actual.versionNumber) >= 170000) throw Error('PostgreSQL16 obrigatório');
    ready = true;
    second = new PrismaClient({ datasources: { db: { url: process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL } } });
    await prisma.adnDocument.createMany({ data: ids.map((id, i) => ({ id, nsu: nsuBase + BigInt(i),
      cnpjPrestador: [A, B, B, A][i], cnpjTomador: [B, C, A, B][i],
      updatedAt: new Date('2026-11-20T10:00:00Z'), competencia: new Date('2026-11-01T00:00:00Z'),
      status: 'authorized', xmlPlain: '<fixture/>' })) });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (ready) await prisma.adnDocument.deleteMany({ where: { id: { in: ownedIds } } });
    await second?.$disconnect();
    await prisma.$disconnect();
  });
  test.each(['todas', 'emitidas', 'recebidas'])('keyset %s sem vazamento ou escrita', async direcao => {
    const before = await prisma.adnDocument.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    let cursor; const received = [];
    do {
      const page = await AdnRepository.listNotas({ cnpj: A, direcao, limit: 1, cursor });
      received.push(...page.items.map(x => x.id)); cursor = page.nextCursor;
      if (received.length > ids.length) throw Error('Cursor não encerrou');
    } while (cursor);
    expect(received).toEqual((direcao === 'emitidas' ? [0, 3] : direcao === 'recebidas' ? [2] : [0, 2, 3]).map(i => ids[i]));
    expect(await prisma.adnDocument.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })).toEqual(before);
  });
  test('cursores externos, inválidos, filtros, vazio e leitores concorrentes', async () => {
    const cursor = Buffer.from(JSON.stringify({ id: ids[1], updatedAt: '2026-11-20T10:00:00Z' })).toString('base64');
    const [a, b, invalid, empty] = await Promise.all([
      AdnRepository.listNotas({ cnpj: A, cursor, status: 'AUTORIZADA', competencia: '2026-11' }),
      AdnRepository.listNotas({ cnpj: B, direcao: 'emitidas' }),
      AdnRepository.listNotas({ cnpj: A, cursor: 'invalid' }),
      AdnRepository.listNotas({ cnpj: A, competencia: '2026-10' }),
    ]);
    expect(a.items.map(x => x.id)).toEqual([ids[2], ids[3]]);
    expect(b.items.map(x => x.id)).toEqual([ids[1], ids[2]]);
    expect(invalid.cursor).toBeNull(); expect(invalid.items).toHaveLength(3);
    expect(empty.items).toEqual([]);
  });
  test('colisão NSU não substitui documento alheio nem outra identidade da mesma empresa', async () => {
    const other = await fixture({ cnpjPrestador: B, chaveAcesso: 'other-' + tag, xmlPlain: '<original/>' });
    await expect(AdnRepository.upsertDocument({ nsu: other.nsu, cnpjPrestador: A,
      chaveAcesso: 'candidate-' + tag, xmlPlain: '<candidate/>' }, { cnpjConsulta: A }))
      .rejects.toMatchObject({ code: 'ADN_DOCUMENTO_OUTRO_CNPJ' });
    expect(await prisma.adnDocument.findUnique({ where: { id: other.id } })).toEqual(other);
    const own = await fixture({ chaveAcesso: 'own-' + tag, xmlPlain: '<original/>' });
    await expect(AdnRepository.upsertDocument({ nsu: own.nsu, cnpjPrestador: A,
      chaveAcesso: 'different-' + tag }, { cnpjConsulta: A })).rejects.toMatchObject({ code: 'ADN_IDENTIDADE_DOCUMENTAL_CONFLITANTE' });
    expect(await prisma.adnDocument.findUnique({ where: { id: own.id } })).toEqual(own);
  });
  test('sem contexto ou alheio não cria; repetição válida não duplica', async () => {
    const nsu = nextNsu();
    const payload = { nsu, cnpjPrestador: A, chaveAcesso: 'replay-' + tag, xmlPlain: '<same/>' };
    await expect(AdnRepository.upsertDocument(payload)).rejects.toHaveProperty('code');
    await expect(AdnRepository.upsertDocument(payload, { cnpjConsulta: B })).rejects.toMatchObject({ code: 'ADN_DOCUMENTO_OUTRO_CNPJ' });
    expect(await prisma.adnDocument.findUnique({ where: { nsu } })).toBeNull();
    const first = await AdnRepository.upsertDocument(payload, { cnpjConsulta: A });
    ownedIds.push(first.document.id);
    const replay = await AdnRepository.upsertDocument(payload, { cnpjConsulta: A });
    expect(replay.document.id).toBe(first.document.id);
    expect(await prisma.adnDocument.count({ where: { nsu } })).toBe(1);
  });
  test('atualização por chave não modifica empresa alheia', async () => {
    const chaveAcesso = 'shared-' + tag;
    const own = await fixture({ chaveAcesso, cnpjTomador: B, xmlPlain: '<own/>' });
    const other = await fixture({ cnpjPrestador: B, cnpjTomador: C, chaveAcesso, xmlPlain: '<other/>' });
    await AdnRepository.updateByChaveAcesso(chaveAcesso, { cnpjPrestador: A, xmlPlain: '<updated/>' }, { cnpjConsulta: A });
    expect((await prisma.adnDocument.findUnique({ where: { id: own.id } })).xmlPlain).toBe('<updated/>');
    expect((await prisma.adnDocument.findUnique({ where: { id: own.id } })).cnpjTomador).toBe(B);
    expect(await prisma.adnDocument.findUnique({ where: { id: other.id } })).toEqual(other);
    await expect(AdnRepository.updateByChaveAcesso(chaveAcesso, { cnpjPrestador: B }, { cnpjConsulta: A }))
      .rejects.toMatchObject({ code: 'ADN_DOCUMENTO_OUTRO_CNPJ' });
    expect(await prisma.adnDocument.findUnique({ where: { id: other.id } })).toEqual(other);
  });
  test('criações concorrentes de empresas distintas no mesmo NSU não sobrescrevem o vencedor', async () => {
    const nsu = nextNsu();
    const find = prisma.adnDocument.findUnique.bind(prisma.adnDocument);
    let arrived = 0, release;
    const bothRead = new Promise(resolve => { release = resolve; });
    const spy = jest.spyOn(prisma.adnDocument, 'findUnique').mockImplementation(async args => {
      const result = await find(args);
      if (args.where.nsu === nsu && !result) {
        arrived++;
        if (arrived === 2) release();
        await bothRead;
      }
      return result;
    });
    try {
      const results = await Promise.allSettled([A, B].map(cnpj => AdnRepository.upsertDocument({
        nsu, cnpjPrestador: cnpj, chaveAcesso: 'concurrent-' + cnpj + '-' + tag,
        xmlPlain: '<fixture-' + cnpj + '/>',
      }, { cnpjConsulta: cnpj })));
      expect(arrived).toBe(2);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(result => result.status === 'rejected').reason.code).toBe('ADN_DOCUMENTO_OUTRO_CNPJ');
      const stored = await find({ where: { nsu } });
      ownedIds.push(stored.id);
      const winner = results.find(result => result.status === 'fulfilled').value.document;
      expect(stored.id).toBe(winner.id);
      expect(stored.cnpjPrestador).toBe(winner.cnpjPrestador);
      expect(stored.xmlPlain).toBe('<fixture-' + winner.cnpjPrestador + '/>');
      expect(await prisma.adnDocument.count({ where: { nsu } })).toBe(1);
    } finally {
      release(); spy.mockRestore();
      const stored = await find({ where: { nsu } });
      if (stored && !ownedIds.includes(stored.id)) ownedIds.push(stored.id);
    }
  });
  test('duas conexões: alteração após releitura impede sobrescrita e preserva vencedor', async () => {
    const original = await fixture({ chaveAcesso: 'race-' + tag, xmlPlain: '<before/>', updatedAt: new Date('2026-11-20T00:00:00Z') });
    let observed, release;
    const read = new Promise(resolve => { observed = resolve; });
    const proceed = new Promise(resolve => { release = resolve; });
    const find = prisma.adnDocument.findUnique.bind(prisma.adnDocument);
    const spy = jest.spyOn(prisma.adnDocument, 'findUnique').mockImplementation(async args => {
      const result = await find(args);
      if (args.where.nsu === original.nsu) { observed(); await proceed; }
      return result;
    });
    let pending;
    try {
      await second.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT id FROM "AdnDocument" WHERE id = $1 FOR UPDATE', original.id);
        pending = AdnRepository.upsertDocument({ nsu: original.nsu, chaveAcesso: original.chaveAcesso,
          cnpjPrestador: A, xmlPlain: '<loser/>' }, { cnpjConsulta: A });
        await read;
        await tx.adnDocument.update({ where: { id: original.id }, data: { xmlPlain: '<winner/>', updatedAt: new Date('2026-11-21T00:00:00Z') } });
      }, { timeout: 10000 });
      release();
      await expect(pending).rejects.toMatchObject({ code: 'ADN_ATUALIZACAO_CONCORRENTE' });
      expect((await find({ where: { id: original.id } })).xmlPlain).toBe('<winner/>');
    } finally { release(); spy.mockRestore(); await pending?.catch(() => {}); }
  }, 15000);
});


