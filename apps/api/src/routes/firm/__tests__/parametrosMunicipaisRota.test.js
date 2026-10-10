import express from 'express';
import request from 'supertest';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
jest.mock('../../../application/nfse/parametrosMunicipaisService.js', () => ({ criarServicoParametros: jest.fn() }));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createParametrosMunicipaisRouter } from '../parametrosMunicipais.js';
function app(user = { id: 'contador', role: 'accountant' }) {
  const servico = { listar: jest.fn(async () => ({ consultas: [] })), consultar: jest.fn(async x => ({ status: 'RECEBIDO_PARA_CONFERENCIA', portalClientId: x.portalClientId })) };
  const a = express(); a.use(express.json()); a.use((req, _res, next) => { req.auth = { user }; next(); });
  a.use('/companies/:companyId', createParametrosMunicipaisRouter({ servico }));
  return { a, servico };
}
beforeEach(() => { jest.clearAllMocks(); prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] }); });
test('consulta usa a empresa da rota e o autor autenticado', async () => {
  const { a, servico } = app();
  const corpo = { recurso: 'convenio', requestKey: 'consulta-123456789' };
  expect((await request(a).post('/companies/portal/parametros-municipais/consultas').send(corpo)).status).toBe(200);
  expect(servico.consultar).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: 'portal', autorId: 'contador', ...corpo }));
});
test.each([null, { role: 'STAFF', status: 'ACTIVE' }, { role: 'ACCOUNTANT', status: 'INACTIVE' }])('sem carteira/nível/atividade não lê nem consulta: %p', async acesso => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue(acesso);
  const { a, servico } = app();
  expect((await request(a).get('/companies/outra/parametros-municipais')).status).toBe(403);
  expect((await request(a).post('/companies/outra/parametros-municipais/consultas').send({})).status).toBe(403);
  expect(servico.listar).not.toHaveBeenCalled(); expect(servico.consultar).not.toHaveBeenCalled();
});
test('requisição não injeta empresa, autor ou endpoint', async () => {
  const { a, servico } = app();
  expect((await request(a).post('/companies/portal/parametros-municipais/consultas').send({ companyId: 'outra', origem: 'https://outro' })).status).toBe(400);
  expect(servico.consultar).not.toHaveBeenCalled();
});
test('GET lê somente registros locais', async () => {
  const { a, servico } = app(); await request(a).get('/companies/portal/parametros-municipais');
  expect(servico.listar).toHaveBeenCalledWith('portal'); expect(servico.consultar).not.toHaveBeenCalled();
});
test('erro interno não retorna credenciais/configuração', async () => {
  const { a, servico } = app(); servico.listar.mockRejectedValue(new Error('senha-secreta'));
  const r = await request(a).get('/companies/portal/parametros-municipais');
  expect(r.status).toBe(503); expect(r.text).not.toContain('senha-secreta');
});
