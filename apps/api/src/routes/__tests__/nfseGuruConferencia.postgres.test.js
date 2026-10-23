// Troca apenas o singleton por Prisma REAL com URL descartável validada.
// Não importar config/dotenv nem consultar DATABASE_URL neste ensaio.
jest.mock('../../config.js', () => ({ NFSE_ENV: 'homologacao' }));
jest.mock('../../infrastructure/db/prisma.js', () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('ALTAN_GOVERNANCE_TEST_DATABASE_URL obrigatória');
  const url = new URL(raw);
  if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) {
    throw Error('Exigir NODE_ENV=test e PostgreSQL loopback *_governance_test sem opções');
  }
  const { PrismaClient } = require('@prisma/client');
  return { prisma: new PrismaClient({ datasources: { db: { url: raw } } }) };
});
// Sentinelas dos atos fiscais: nenhum destes métodos pode ser chamado.
jest.mock('../../application/nfse/NfseService.js', () => ({ NfseService: {
  issue: jest.fn(), sendEvent: jest.fn(), syncFromProvider: jest.fn(), conciliarTentativa: jest.fn(),
} }));
jest.mock('../../application/nfse/NfseRecorrenciaService.js', () => ({
  criarRecorrencia: jest.fn(), listarRecorrencias: jest.fn(), pausarRecorrencia: jest.fn(), retomarRecorrencia: jest.fn(),
}));
jest.mock('../../application/nfse/guru/GuruHttpClient.js', () => {
  const provider = { pagina: jest.fn() };
  return { criarGuruHttpClient: () => provider };
});

import express from 'express';
import request from 'supertest';
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { prisma as db } from '../../infrastructure/db/prisma.js';
import { NfseService } from '../../application/nfse/NfseService.js';
import * as recorrencias from '../../application/nfse/NfseRecorrenciaService.js';
import { createNfseRouter } from '../nfse.js';
import { criarGuruHttpClient } from '../../application/nfse/guru/GuruHttpClient.js';
import { periodo, transacao, pagina } from '../../application/nfse/guru/__tests__/fixtures/transacoesGuru.js';

test.each(['test', 'production'])('createNfseRouter + Guru real + PostgreSQL em %s: conferência isolada, replay e PortalClient → Company', async ambiente => {
  const suffix = randomUUID();
  const companyId = `guru-http-company-${suffix}`, otherId = `guru-http-other-${suffix}`;
  const portalId = `guru-http-portal-${suffix}`, clientId = `guru-http-client-${suffix}`;
  const userId = `guru-http-user-${suffix}`, clientUserId = `guru-http-client-user-${suffix}`;
  const previous = [process.env.GURU_CONFERENCIA_COMPANY_ID, process.env.GURU_CONFERENCIA_ACCOUNT_ID];
  const importEnvNames = ['GURU_CONFERENCIA_IMPORT_ENABLED', 'GURU_CONFERENCIA_CREDENTIAL_SCOPE', 'GURU_CONFERENCIA_USER_TOKEN',
    'GURU_CONFERENCIA_PRODUCTION_ENABLED', 'NODE_ENV'];
  const importEnvPrevious = importEnvNames.map(name => process.env[name]);
  process.env.GURU_CONFERENCIA_IMPORT_ENABLED = 'true';
  process.env.GURU_CONFERENCIA_CREDENTIAL_SCOPE = 'EXCLUSIVE_PILOT';
  process.env.GURU_CONFERENCIA_USER_TOKEN = 'fixture-sem-credencial-real';
  const provider = criarGuruHttpClient(); provider.pagina.mockReset();
  provider.pagina.mockResolvedValue(pagina([transacao('importacao-http-sintetica')]));
  process.env.GURU_CONFERENCIA_COMPANY_ID = companyId;
  process.env.GURU_CONFERENCIA_ACCOUNT_ID = `guru-http-account-${suffix}`;
  const blockedTransport = jest.fn(() => { throw Error('Transporte externo proibido'); });
  const spies = [];
  let server;
  try {
    await db.client.create({ data: { id: clientId, name: 'Fixture local', email: `${suffix}@example.invalid`, login: suffix, passwordHash: 'inutilizavel' } });
    await db.user.createMany({ data: [
      { id: userId, email: `staff-${suffix}@example.invalid`, passwordHash: 'inutilizavel', role: 'contador', status: 'active' },
      { id: clientUserId, email: `client-${suffix}@example.invalid`, passwordHash: 'inutilizavel', role: 'client', status: 'active' },
    ] });
    await db.company.createMany({ data: [companyId, otherId].map(id => ({
      id, clientId, razaoSocial: 'Fixture sem identidade fiscal real', cnpj: id, atividades: [],
    })) });
    await db.portalClient.create({ data: { id: portalId, companyId, razao: 'Fixture portal', cnpj: `portal-${suffix}` } });

    // Fronteira de sessão SIMULADA. Não testa login, senha nem validação real de API key.
    // A política allowApiKeyFallback=false é verificada em cada requisição.
    const ensureAuthorized = jest.fn(async (req, res, options) => {
      expect(options).toEqual({ allowApiKeyFallback: false });
      const session = req.get('x-test-session');
      if (!['contador', 'cliente'].includes(session)) {
        res.status(401).json({ error: 'unauthorized' }); return false;
      }
      req.auth = { user: await db.user.findUnique({ where: { id: session === 'contador' ? userId : clientUserId } }) };
      return true;
    });
    const app = express(); app.use(express.json());
    app.use('/nfse', createNfseRouter({ ensureAuthorized }));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const originalRequest = http.request;
    // Só a porta exata do Supertest é permitida. PostgreSQL usa seu protocolo próprio.
    spies.push(jest.spyOn(http, 'request').mockImplementation(function (options, ...rest) {
      const target = typeof options === 'string' ? new URL(options) : options;
      const host = target.hostname || target.host;
      if (host === '127.0.0.1' && Number(target.port) === port) return originalRequest.call(this, options, ...rest);
      return blockedTransport();
    }));
    spies.push(jest.spyOn(https, 'request').mockImplementation(blockedTransport));
    if (global.fetch) spies.push(jest.spyOn(global, 'fetch').mockImplementation(blockedTransport));
    const base = `/nfse/guru-conferencia/${portalId}/preparacoes`;
    const post = (path, body, session = 'contador') => request(server).post(path).set('x-test-session', session).send(body);
    const get = path => request(server).get(path).set('x-test-session', 'contador');
    const body = { transacaoId: `transacao-${suffix}`, referenciaOrigem: 'Evidência sintética local',
      valorCentavos: 12345, moeda: 'BRL', situacaoPagamento: 'INFORMADO_PAGO' };
    process.env.NODE_ENV = ambiente;
    delete process.env.GURU_CONFERENCIA_PRODUCTION_ENABLED;
    if (ambiente === 'production') {
      expect((await get(base)).status).toBe(403);
      expect((await post(base, body)).status).toBe(403);
      expect(provider.pagina).not.toHaveBeenCalled();
      process.env.GURU_CONFERENCIA_PRODUCTION_ENABLED = 'true';
    }
    const invariant = item => {
      expect(item).toMatchObject({ companyId, modo: 'CONFERENCIA', emissaoBloqueada: true,
        emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA',
        entrega: 'NAO_REALIZADA', baixaContabil: 'NAO_REALIZADA', conexaoGuru: 'NAO_REALIZADA' });
      expect(item).not.toHaveProperty('nota');
    };
    const prepared = await post(base, body);
    expect(prepared.status).toBe(201);
    const item = prepared.body.item; invariant(item);
    const detail = `${base}/${item.id}`;
    const read = await get(detail);
    expect(read.status).toBe(200); expect(read.body.item).toEqual(item); invariant(read.body.item);
    const legacy = await get(`/nfse/guru-conferencia/${companyId}/preparacoes/${item.id}`);
    expect(legacy.status).toBe(200); expect(legacy.body.item).toEqual(item);
    const replayPrepare = await post(base, body);
    expect(replayPrepare.status).toBe(200); expect(replayPrepare.body).toEqual({ item, repetida: true });
    const command = { versao: item.versao, hash: item.hash, confirmada: true };
    for (const field of ['nota', 'emissaoAltan', 'situacaoFiscalExterna']) {
      expect((await post(base, { ...body, [field]: 'NAO_EMITIDA' })).status).toBe(400);
      expect((await post(`${detail}/conferir`, { ...command, [field]: 'NAO_VERIFICADA' })).status).toBe(400);
    }
    const confirmed = await post(`${detail}/conferir`, command);
    expect(confirmed.status).toBe(200); invariant(confirmed.body.item);
    expect(confirmed.body.item).toMatchObject({ estado: 'CONFERIDA', versao: 2 });
    expect(confirmed.body.item.historico).toHaveLength(2);
    const replay = await post(`${detail}/conferir`, command);
    expect(replay.status).toBe(200); expect(replay.body).toEqual({ item: confirmed.body.item, repetida: true });
    expect((await get(detail)).body.item).toEqual(confirmed.body.item);
    const emission = await post(`${detail}/emitir`, { modo: 'EMISSAO' });
    expect(emission.status).toBe(409); expect(emission.body.error).toBe('guru_emissao_bloqueada_modo_conferencia');

    for (const [method, tail, payload] of [['post', '', body], ['get', `/${item.id}`, null],
      ['post', `/${item.id}/conferir`, command], ['post', `/${item.id}/emitir`, {}]]) {
      const client = request(server)[method](`${base}${tail}`).set('x-test-session', 'cliente');
      if (payload) client.send(payload);
      expect((await client).status).toBe(403);
      const apiKey = request(server)[method](`${base}${tail}`).set('x-api-key', 'fixture-inutilizavel');
      if (payload) apiKey.send(payload);
      expect((await apiKey).status).toBe(401);
      const other = request(server)[method](`/nfse/guru-conferencia/${otherId}/preparacoes${tail}`).set('x-test-session', 'contador');
      if (payload) other.send(payload);
      expect((await other).status).toBe(403);
    }
    const rows = await db.appSetting.findMany({ where: { value: { path: ['companyId'], equals: companyId } } });
    expect(rows).toHaveLength(1); expect(rows[0].value).toEqual(confirmed.body.item); invariant(rows[0].value);
    expect((await get(base)).body.total).toBe(1);
    expect(provider.pagina).not.toHaveBeenCalled();
    const importPath = `/nfse/guru-conferencia/${portalId}/importacoes`;
    const imported = await post(importPath, periodo);
    expect(imported.status).toBe(200); expect(imported.body).toMatchObject({ criadas: 1, lidas: 1, estado: 'CONCLUIDA' });
    expect((await post(importPath, periodo)).body).toMatchObject({ repetidas: 1, criadas: 0 });
    expect((await get(base)).body.total).toBe(2);
    const apiItem = (await get(base)).body.items.find(i => i.origem === 'GURU_API');
    expect(apiItem.situacaoFiscalExterna).toBe('NAO_VERIFICADA');
    const apiDetail = `${base}/${apiItem.id}`;
    expect((await post(`${apiDetail}/conferir`, { versao: apiItem.versao, hash: apiItem.hash, confirmada: true })).status).toBe(200);
    provider.pagina.mockResolvedValue(pagina([transacao('importacao-http-sintetica', { status: 'refunded' })]));
    expect((await post(importPath, periodo)).body.conflitos).toBe(1);
    expect((await get(apiDetail)).body.item.estado).toBe('CONFLITO');
    expect((await post(`${apiDetail}/conferir`, { versao: apiItem.versao, hash: apiItem.hash, confirmada: true })).status).toBe(409);
    expect((await post(`${apiDetail}/emitir`, {})).status).toBe(409);
    expect((await post(importPath, periodo, 'cliente')).status).toBe(403);
    expect((await request(server).post(importPath).set('x-api-key', 'fixture').send(periodo)).status).toBe(401);
    expect((await post(`/nfse/guru-conferencia/${otherId}/importacoes`, periodo)).status).toBe(403);
    const chamadas = provider.pagina.mock.calls.length;
    process.env.NODE_ENV = 'production';
    delete process.env.GURU_CONFERENCIA_PRODUCTION_ENABLED;
    expect((await post(importPath, periodo)).status).toBe(403);
    expect((await post(base, body)).status).toBe(403);
    expect((await post(`${detail}/conferir`, command)).status).toBe(403);
    expect((await get(detail)).status).toBe(403);
    expect(provider.pagina).toHaveBeenCalledTimes(chamadas);
    expect(await db.appSetting.count({ where: { value: { path: ['companyId'], equals: otherId } } })).toBe(0);
    expect(await db.serviceInvoice.count({ where: { companyId: { in: [companyId, otherId] } } })).toBe(0);
    for (const fn of [
      ...Object.values(NfseService),
      recorrencias.criarRecorrencia, recorrencias.listarRecorrencias,
      recorrencias.pausarRecorrencia, recorrencias.retomarRecorrencia,
    ]) expect(fn).not.toHaveBeenCalled();
    expect(blockedTransport).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
    if (server) await new Promise(resolve => server.close(resolve));
    for (const [index, name] of ['GURU_CONFERENCIA_COMPANY_ID', 'GURU_CONFERENCIA_ACCOUNT_ID'].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
    importEnvNames.forEach((name, index) => { if (importEnvPrevious[index] === undefined) delete process.env[name]; else process.env[name] = importEnvPrevious[index]; });
    // Limpeza somente das identidades sintéticas deste teste, nunca truncate.
    try {
      await db.appSetting.deleteMany({ where: { key: { startsWith: 'guru-conferencia:v1:' }, value: { path: ['companyId'], equals: companyId } } });
      await db.appSetting.deleteMany({ where: { key: { startsWith: 'guru-importacao:v1:' }, value: { path: ['companyId'], equals: companyId } } });
      await db.portalClient.deleteMany({ where: { id: portalId } });
      await db.company.deleteMany({ where: { id: { in: [companyId, otherId] } } });
      await db.user.deleteMany({ where: { id: { in: [userId, clientUserId] } } });
      await db.client.deleteMany({ where: { id: clientId } });
    } finally { await db.$disconnect(); }
  }
}, 30000);
