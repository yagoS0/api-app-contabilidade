// Real PostgreSQL reservations, dispatch markers and response cache. No HTTP/authentication
// or credentials leave this process. Guide/accounting persistence is covered by 44/442/443.
jest.mock('axios', () => ({ request: jest.fn(), isAxiosError: error => error?.isAxiosError === true }));
jest.mock('../SerproAuthService.js', () => ({ SerproAuthService: jest.fn(() => ({
  authenticate: jest.fn(async () => ({ accessToken: 'synthetic', jwtToken: 'synthetic' })),
  buildHttpsAgent: jest.fn(async () => null),
})) }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ baseUrl: 'https://invalid.test', timeoutMs: 10 })) }));

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { prisma as db } from '../../../../infrastructure/db/prisma.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { autorizarChamada, autorizarDespacho, concluirChamada } from '../SerproCallGuard.js';
import { chaveResposta, lerResposta, guardarResposta } from '../SerproRespostaCache.js';
import { comContextoSerpro } from '../serproCallContext.js';

const suite = process.env.ALTAN_TESTE_POSTGRES === '1' ? describe : describe.skip;
const databaseUrl = process.env.TEST_CICLO_PG_URL || process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
const route = '/Emitir';
const response = () => ({ status: 200, data: { pdf: Buffer.from('%PDF-SYNTHETIC-' + randomUUID()).toString('base64'), numeroDocumento: randomUUID() }, headers: {} });
let connections = [];
function connection() {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  connections.push(client); return client;
}
async function fixture(serviceId) {
  const id = randomUUID();
  const cnpj = BigInt('0x' + id.replace(/-/g, '').slice(0, 10)).toString().padStart(14, '0');
  const portal = await db.portalClient.create({ data: { id, cnpj, razao: 'DAS444 SYNTHETIC ' + id } });
  const payload = { contribuinte: { numero: cnpj, tipo: 2 }, pedidoDados: {
    idSistema: 'PGDASD', idServico: serviceId, dados: JSON.stringify({ periodoApuracao: '202610' }),
  } };
  return { portal, payload, signature: chaveResposta(payload, route) };
}
const rows = (client, signature) => client.serproChamada.findMany({ where: { assinatura: signature }, orderBy: { createdAt: 'asc' } });
const reserve = (payload, client = db) => autorizarChamada({ payload, rota: route }, client);

suite('DAS 4.4.4 real PostgreSQL16 — persistent uncertainty and cache boundaries', () => {
  beforeAll(async () => {
    const raw = databaseUrl;
    const url = new URL(raw);
    if (process.env.NODE_ENV !== 'test' || raw !== process.env.DATABASE_URL ||
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) {
      throw Error('Explicit disposable loopback PostgreSQL URL required');
    }
    // Read only validation precedes all fixtures/writes. Never silently accept another database/version.
    const [actual] = await db.$queryRawUnsafe("SELECT current_database() AS name, current_setting('server_version_num') AS version");
    expect(actual.name).toBe(url.pathname.slice(1));
    expect(Number(actual.version)).toBeGreaterThanOrEqual(160000);
    expect(Number(actual.version)).toBeLessThan(170000);
  });
  beforeEach(() => { jest.restoreAllMocks(); axios.request.mockReset().mockResolvedValue(response()); });
  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(connections.map(client => client.$disconnect())); connections = [];
  });
  afterAll(async () => { await db.$disconnect(); });

  describe.each(['GERARDAS12', 'GERARDASCOBRANCA17'])('%s', serviceId => {
    test('HTTP timeout becomes incerta; disconnect/new PrismaClient and force cannot repeat signature', async () => {
      const { portal, payload, signature } = await fixture(serviceId);
      axios.request.mockRejectedValueOnce(Object.assign(Error('synthetic timeout'), { isAxiosError: true, code: 'ECONNABORTED' }));
      await expect(new SerproHttpClient().post(route, payload)).rejects.toMatchObject({ code: 'SERPRO_TIMEOUT', retryable: true });
      const [before] = await rows(db, signature);
      expect(before).toMatchObject({ status: 'incerta', httpStatus: null, erroCodigo: 'SERPRO_TIMEOUT', portalClientId: portal.id });
      await db.$disconnect();
      const fresh = connection();
      expect((await rows(fresh, signature))[0]).toMatchObject({ id: before.id, status: 'incerta' });
      expect(await fresh.appSetting.findUnique({ where: { key: `serpro_dispatch:${before.id}` } })).not.toBeNull();
      await expect(comContextoSerpro({ forcar: true, userId: randomUUID(), origem: 'das444-synthetic' }, () => reserve(payload, fresh)))
        .rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO', status: 409 });
      const after = await rows(fresh, signature);
      expect(after.filter(row => row.status === 'incerta')).toHaveLength(1);
      expect(after.filter(row => row.status === 'recusada_cooldown')).toHaveLength(1);
      expect(await lerResposta(payload, route, fresh)).toBeNull();
      expect(axios.request).toHaveBeenCalledTimes(1);
    });

    test('HTTP accepted but cache write fails: reservation and dispatch survive without response or local document', async () => {
      const { portal, payload, signature } = await fixture(serviceId);
      const fail = jest.spyOn(db.serproRespostaCache, 'upsert').mockRejectedValueOnce(Error('synthetic cache outage'));
      await expect(new SerproHttpClient().post(route, payload)).rejects.toMatchObject({ code: 'SERPRO_REGISTRO_INDETERMINADO' });
      fail.mockRestore();
      const [reservation] = await rows(db, signature);
      expect(reservation).toMatchObject({ status: 'reservada', httpStatus: null });
      await db.$disconnect();
      const fresh = connection();
      expect((await rows(fresh, signature))[0].id).toBe(reservation.id);
      expect(await fresh.appSetting.findUnique({ where: { key: `serpro_dispatch:${reservation.id}` } })).not.toBeNull();
      expect(await lerResposta(payload, route, fresh)).toBeNull();
      expect(await fresh.guide.count({ where: { portalClientId: portal.id } })).toBe(0);
      await expect(reserve(payload, fresh)).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
      expect(axios.request).toHaveBeenCalledTimes(1);
    });

    test('ledger outage after HTTP/cache: valid DAS cache bypasses pending reservation without finalizing it', async () => {
      const { portal, payload, signature } = await fixture(serviceId);
      const accepted = response(); axios.request.mockResolvedValueOnce(accepted);
      const fail = jest.spyOn(db.serproChamada, 'updateMany').mockRejectedValueOnce(Error('synthetic ledger outage'));
      await expect(new SerproHttpClient().post(route, payload)).rejects.toMatchObject({ code: 'SERPRO_REGISTRO_INDETERMINADO', status: 409 });
      fail.mockRestore();
      const [reservation] = await rows(db, signature);
      expect(reservation.status).toBe('reservada');
      await db.$disconnect();
      const fresh = connection();
      expect(await lerResposta(payload, route, fresh)).toEqual(accepted.data);
      expect(await new SerproHttpClient().post(route, payload, { raw: true })).toEqual({ status: 200, data: accepted.data, headers: {} });
      expect(await rows(fresh, signature)).toEqual([reservation]);
      expect(await fresh.guide.count({ where: { portalClientId: portal.id } })).toBe(0);
      expect(axios.request).toHaveBeenCalledTimes(1);
      // Only invalidate this synthetic cache via its existing explicit update context.
      await expect(comContextoSerpro({ atualizar: true }, () => new SerproHttpClient().post(route, payload)))
        .rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
      expect(await fresh.serproRespostaCache.findUnique({ where: { chave: signature } })).toBeNull();
      expect((await rows(fresh, signature)).find(row => row.id === reservation.id).status).toBe('reservada');
      expect(axios.request).toHaveBeenCalledTimes(1);
    });

    test('incerta with cache: valid response is readable, expiration does not release signature', async () => {
      const { payload, signature } = await fixture(serviceId);
      const reservation = await reserve(payload);
      await autorizarDespacho(reservation);
      await concluirChamada(reservation, { erroCodigo: 'SERPRO_TIMEOUT' });
      const accepted = response();
      await guardarResposta(payload, route, accepted);
      const before = await rows(db, signature);
      expect(await new SerproHttpClient().post(route, payload)).toEqual(accepted.data);
      expect(await rows(db, signature)).toEqual(before);
      // Expire only the UUID fixture's row, not the production TTL or clock policy.
      await db.serproRespostaCache.update({ where: { chave: signature }, data: { expiraEm: new Date(Date.now() - 1000) } });
      await expect(new SerproHttpClient().post(route, payload)).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
      expect((await rows(db, signature)).find(row => row.id === reservation.id).status).toBe('incerta');
      expect(axios.request).not.toHaveBeenCalled();
    });

    test('two connections contend for canonical signature; another company has separate reservation and cache', async () => {
      const a = await fixture(serviceId), b = await fixture(serviceId), other = connection();
      const reordered = { pedidoDados: { dados: { periodoApuracao: '202610' }, idServico: serviceId, idSistema: 'PGDASD' }, contribuinte: { tipo: 2, numero: a.portal.cnpj } };
      expect(chaveResposta(reordered, route)).toBe(a.signature);
      const results = await Promise.allSettled([reserve(a.payload), reserve(reordered, other)]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
      const winner = results.find(result => result.status === 'fulfilled').value;
      const dispatches = await Promise.allSettled([autorizarDespacho(winner), autorizarDespacho(winner, other)]);
      expect(dispatches.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(dispatches.find(result => result.status === 'rejected').reason).toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
      await concluirChamada(winner, { erroCodigo: 'SERPRO_TIMEOUT' });
      const second = await reserve(b.payload, other);
      const accepted = response(); await guardarResposta(a.payload, route, accepted);
      expect(await lerResposta(a.payload, route, other)).toEqual(accepted.data);
      expect(await lerResposta(b.payload, route, other)).toBeNull();
      expect((await rows(other, a.signature)).filter(row => row.status === 'incerta')).toHaveLength(1);
      expect(await rows(other, b.signature)).toEqual([expect.objectContaining({ id: second.id, portalClientId: b.portal.id, status: 'reservada' })]);
      expect(axios.request).not.toHaveBeenCalled();
    });
  });
});
