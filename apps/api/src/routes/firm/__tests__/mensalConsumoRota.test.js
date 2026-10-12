import express from 'express';
import request from 'supertest';
import { createApuracaoConsumoRouter } from '../apuracaoConsumo.js';
jest.mock('../../../application/fiscal/consumo/MensalConsumoService.js', () => ({ lerMensalConsumo: jest.fn(), listarHistoricoMensalConsumo: jest.fn(), executarAcaoMensalConsumo: jest.fn() }));
jest.mock('../../../application/fiscal/consumo/ReplayCbsService.js', () => ({ reprocessarArquivoCbs: jest.fn() }));
import * as mensal from '../../../application/fiscal/consumo/MensalConsumoService.js';
import { reprocessarArquivoCbs } from '../../../application/fiscal/consumo/ReplayCbsService.js';
const usuario = { id: 'u', role: 'contador' }, base = '/companies/a/apuracao-consumo';
let app, role;
beforeEach(() => {
  jest.clearAllMocks(); role = 'ACCOUNTANT'; app = express(); app.use(express.json());
  app.use((req, res, next) => { req.auth = { user: usuario }; next(); });
  app.use(createApuracaoConsumoRouter({ prisma: 'db', requireFirmCompanyAccess: ({ minRole }) => (req, res, next) => {
    if (minRole !== 'ACCOUNTANT' || role !== 'ACCOUNTANT' || req.params.companyId !== 'a') return res.sendStatus(403); next();
  } }));
});
test.each([['/mensal', 'lerMensalConsumo'], ['/mensal/historico', 'listarHistoricoMensalConsumo']])('leitura %s usa contexto autenticado e no-store', async (path, method) => {
  mensal[method].mockResolvedValue({ versao: 0 });
  const r = await request(app).get(`${base}${path}?tributo=IBS&ambiente=PRODUCAO&competencia=2027-01`);
  expect(r.status).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
  expect(mensal[method]).toHaveBeenCalledWith('db', 'a', { tributo: 'IBS', ambiente: 'PRODUCAO', competencia: '2027-01' }, usuario);
});
test('ação mensal retorna DTO inteiro e transmite intenção sem trocar ator', async () => {
  mensal.executarAcaoMensalConsumo.mockResolvedValue({ versao: 1, estado: 'EM_CONFERENCIA' });
  const body = { id: 'intent', tributo: 'CBS', ambiente: 'HOMOLOGACAO', competencia: '2026-10', acao: 'ALOCAR', dados: {} };
  const r = await request(app).post(`${base}/mensal/acoes`).send(body);
  expect(r.body).toEqual({ ok: true, versao: 1, estado: 'EM_CONFERENCIA' });
  expect(mensal.executarAcaoMensalConsumo).toHaveBeenCalledWith('db', 'a', body, usuario);
});
test.each(['GET /mensal', 'GET /mensal/historico', 'POST /mensal/acoes', 'POST /cbs/coletas/coleta/reprocessar'])('STAFF recusado antes serviço: %s', async path => {
  role = 'STAFF'; const [method, suffix] = path.split(' ');
  expect((await request(app)[method.toLowerCase()](base + suffix).send({})).status).toBe(403);
  ['lerMensalConsumo', 'listarHistoricoMensalConsumo', 'executarAcaoMensalConsumo'].forEach(name => expect(mensal[name]).not.toHaveBeenCalled()); expect(reprocessarArquivoCbs).not.toHaveBeenCalled();
});
test('reprocessamento local usa deps vazias por padrão e erro 422 preservado', async () => {
  reprocessarArquivoCbs.mockRejectedValue(Object.assign(Error('Documento ambíguo.'), { status: 422 }));
  const r = await request(app).post(`${base}/cbs/coletas/coleta/reprocessar`).send({ ambiente: 'HOMOLOGACAO' });
  expect(r.status).toBe(422); expect(r.body.reason).toBe('Documento ambíguo.');
  expect(reprocessarArquivoCbs).toHaveBeenCalledWith('db', 'a', 'coleta', { ambiente: 'HOMOLOGACAO' }, usuario, {});
});
