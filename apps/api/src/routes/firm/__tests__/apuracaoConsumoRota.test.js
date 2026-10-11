import express from 'express';
import request from 'supertest';
import { createApuracaoConsumoRouter } from '../apuracaoConsumo.js';
jest.mock('../../../application/fiscal/consumo/ApuracaoConsumoService.js', () => ({
  lerBaseConsumo: jest.fn(), vincularEstabelecimentos: jest.fn(), salvarConfiguracaoConsumo: jest.fn(), prepararRevisaoConsumo: jest.fn(),
}));
import * as service from '../../../application/fiscal/consumo/ApuracaoConsumoService.js';
let app, role;
const user = { id: 'usuario', role: 'contador' };
beforeEach(() => {
  jest.clearAllMocks(); role = 'ACCOUNTANT';
  app = express(); app.use(express.json()); app.use((req, res, next) => { req.auth = { user }; next(); });
  const guard = ({ minRole } = {}) => (req, res, next) => {
    if (!role || req.params.companyId === 'proibida' || (minRole && role === 'STAFF')) return res.status(403).json({ error: 'forbidden' });
    next();
  };
  app.use(createApuracaoConsumoRouter({ prisma: 'db', requireFirmCompanyAccess: guard }));
  service.lerBaseConsumo.mockResolvedValue({ contribuinte: null });
});
test('GET usa identidade autenticada/empresa da URL e não permite cache', async () => {
  const r = await request(app).get('/companies/a/apuracao-consumo?tributo=CBS&ambiente=HOMOLOGACAO&competencia=2027-01');
  expect(r.status).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
  expect(service.lerBaseConsumo).toHaveBeenCalledWith('db', 'a', expect.objectContaining({ tributo: 'CBS' }), user);
});
test.each(['estabelecimentos', 'configuracoes', 'revisoes'])('STAFF não grava %s', async caminho => {
  role = 'STAFF'; expect((await request(app).post(`/companies/a/apuracao-consumo/${caminho}`).send({})).status).toBe(403);
  expect(service.vincularEstabelecimentos).not.toHaveBeenCalled();
  expect(service.salvarConfiguracaoConsumo).not.toHaveBeenCalled();
  expect(service.prepararRevisaoConsumo).not.toHaveBeenCalled();
});
test('empresa fora do acesso não alcança serviço', async () => {
  expect((await request(app).get('/companies/proibida/apuracao-consumo')).status).toBe(403);
  expect(service.lerBaseConsumo).not.toHaveBeenCalled();
});
test('STAFF não lê os metadados de credenciais pela nova rota', async () => {
  role = 'STAFF';
  expect((await request(app).get('/companies/a/apuracao-consumo')).status).toBe(403);
  expect(service.lerBaseConsumo).not.toHaveBeenCalled();
});
test('conflito do domínio é retornado com mensagem recuperável', async () => {
  service.salvarConfiguracaoConsumo.mockRejectedValue(Object.assign(new Error('Recarregue a configuração.'), { status: 409 }));
  const r = await request(app).post('/companies/a/apuracao-consumo/configuracoes').send({ id: 'intencao' });
  expect(r.status).toBe(409); expect(r.body.reason).toBe('Recarregue a configuração.');
});
