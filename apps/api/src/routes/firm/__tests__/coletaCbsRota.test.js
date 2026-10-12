import express from 'express';
import request from 'supertest';
import { createApuracaoConsumoRouter } from '../apuracaoConsumo.js';
jest.mock('../../../application/fiscal/consumo/ColetaCbsService.js', () => ({ listarColetasCbs: jest.fn(), abrirColetaCbs: jest.fn(), consultarColetaCbs: jest.fn(), baixarArquivoColetaCbs: jest.fn() }));
import * as service from '../../../application/fiscal/consumo/ColetaCbsService.js';
const user = { id: 'user', role: 'contador' }, base = '/companies/a/apuracao-consumo/cbs/coletas';
let role, app;
beforeEach(() => {
  jest.clearAllMocks(); role = 'ACCOUNTANT'; app = express(); app.use(express.json());
  app.use((req, res, next) => { req.auth = { user }; next(); });
  const guard = ({ minRole }) => (req, res, next) => role === 'STAFF' || !role || req.params.companyId === 'outra' ? res.sendStatus(403) : next();
  app.use(createApuracaoConsumoRouter({ prisma: 'db', requireFirmCompanyAccess: guard }));
  service.listarColetasCbs.mockResolvedValue({ ambiente: 'HOMOLOGACAO', coletas: [], capacidades: { abrir: false, consultar: false, baixar: false } });
});
test('GET local não chama operações remotas e usa dependências vazias por padrão', async () => {
  const r = await request(app).get(base + '?ambiente=HOMOLOGACAO');
  expect(r.status).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
  expect(service.listarColetasCbs).toHaveBeenCalledWith('db', 'a', { ambiente: 'HOMOLOGACAO' }, user, {});
  for (const name of ['abrirColetaCbs', 'consultarColetaCbs', 'baixarArquivoColetaCbs']) expect(service[name]).not.toHaveBeenCalled();
});

test('compositor assíncrono recebe contexto da sessão e guard rejeita antes de resolvê-lo', async () => {
  const deps = { protecao: { decifrar: jest.fn() } }, resolver = jest.fn(async () => deps);
  const runtimeApp = express(); runtimeApp.use(express.json());
  runtimeApp.use((req, res, next) => { req.auth = { user }; next(); });
  runtimeApp.use(createApuracaoConsumoRouter({ prisma: 'db', cbsDeps: resolver,
    requireFirmCompanyAccess: () => (req, res, next) => role === 'STAFF' ? res.sendStatus(403) : next() }));
  expect((await request(runtimeApp).get(base + '?ambiente=HOMOLOGACAO')).status).toBe(200);
  expect(resolver).toHaveBeenCalledWith({ companyId: 'a', ambiente: 'HOMOLOGACAO', usuario: user });
  expect(service.listarColetasCbs).toHaveBeenLastCalledWith('db', 'a', { ambiente: 'HOMOLOGACAO' }, user, deps);
  service.abrirColetaCbs.mockResolvedValue({ id: 'teste' });
  expect((await request(runtimeApp).post(base).send({ ambiente: 'PRODUCAO' })).status).toBe(200);
  expect(resolver).toHaveBeenLastCalledWith({ companyId: 'a', ambiente: 'PRODUCAO', usuario: user });
  resolver.mockClear(); role = 'STAFF';
  expect((await request(runtimeApp).get(base + '?ambiente=HOMOLOGACAO')).status).toBe(403);
  expect(resolver).not.toHaveBeenCalled();
});
test.each(['', '/c/consultar', '/c/baixar'])('STAFF não inicia operação %s', async suffix => {
  role = 'STAFF'; expect((await request(app).post(base + suffix).send({})).status).toBe(403);
  ['listarColetasCbs', 'abrirColetaCbs', 'consultarColetaCbs', 'baixarArquivoColetaCbs'].forEach(name => expect(service[name]).not.toHaveBeenCalled());
});
test('STAFF não lê o histórico; empresa fora do acesso também é recusada', async () => {
  role = 'STAFF'; expect((await request(app).get(base)).status).toBe(403);
  role = 'ACCOUNTANT'; expect((await request(app).get(base.replace('/a/', '/outra/'))).status).toBe(403);
  expect(service.listarColetasCbs).not.toHaveBeenCalled();
});
test.each([['consultar', 'consultarColetaCbs'], ['baixar', 'baixarArquivoColetaCbs']])('%s preserva empresa, identidade e intenção', async (path, method) => {
  service[method].mockResolvedValue({ id: 'c', estado: 'PENDENTE' });
  const body = { id: 'uuid', ambiente: 'HOMOLOGACAO' };
  const r = await request(app).post(`${base}/c/${path}`).send(body);
  expect(r.status).toBe(200); expect(r.body.coleta.id).toBe('c'); expect(r.headers['cache-control']).toBe('no-store');
  expect(service[method]).toHaveBeenCalledWith('db', 'a', 'c', body, user, {});
});
test.each([400, 409, 502, 503])('falha conhecida %s não vira sucesso ou erro genérico', async status => {
  service.abrirColetaCbs.mockRejectedValue(Object.assign(Error('Operação indisponível.'), { status }));
  const r = await request(app).post(base).send({ id: 'uuid', ambiente: 'HOMOLOGACAO', recurso: 'DEBITOS' });
  expect(r.status).toBe(status); expect(r.body).toEqual({ error: 'apuracao_consumo', reason: 'Operação indisponível.' });
});
