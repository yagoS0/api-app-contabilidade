import express from 'express';
import request from 'supertest';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  portalClient: { findUnique: jest.fn(async () => ({ cnpj: '53742042000164' })) },
  portalInvoice: { findMany: jest.fn(async () => []), updateMany: jest.fn() },
  apuracaoSnapshot: { findUnique: jest.fn(async () => ({ id: 'snapshot', conferenciaStatus: 'ok', conferidaEm: new Date('2026-11-01'), conferenciaResultado: { faltantes: [], extras: [], adnTotal: 0 } })), updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn() },
} }));
jest.mock('../../../middlewares/requireFirmCompanyAccess.js', () => ({ requireFirmCompanyAccess: () => (req, res, next) => {
  if (req.params.companyId !== 'minha') return res.status(403).json({ error: 'forbidden' });
  req.auth = { user: { id: 'contador', role: 'contador' } }; next();
} }));
jest.mock('../../../application/notas/CertResolver.js', () => ({ SERVICOS: { NFSE: 'NFSE' }, resolveCertForCompany: jest.fn(async () => ({ source: 'company_a1', pfxBuffer: Buffer.from('fake') })) }));
jest.mock('../../../application/notas/adn-nacional/AdnNacionalClient.js', () => ({ fetchDfeNFSe: jest.fn() }));
import { fetchDfeNFSe } from '../../../application/notas/adn-nacional/AdnNacionalClient.js';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { manualTasks } from '../../../application/tasks/ManualTaskService.js';
import { createApuracaoV2Router } from '../apuracaoV2.js';
function app() {
  const a = express(); a.use(express.json());
  a.use('/companies/:companyId', createApuracaoV2Router({ log: { warn: jest.fn() } }));
  return a;
}
let execute, start;
beforeEach(() => {
  jest.clearAllMocks();
  execute = null;
  start = jest.spyOn(manualTasks, 'start').mockImplementation(async (_descriptor, run) => { execute = run; return { id: 'task-1', newlyStarted: true }; });
});
afterEach(() => start.mockRestore());
test.each(['REJEICAO', 'DESCONHECIDO', 'DOCUMENTOS_LOCALIZADOS'])('rota/tarefa não anuncia sucesso da resposta %s vazia', async status => {
  fetchDfeNFSe.mockResolvedValueOnce({ status, items: [], errors: status === 'REJEICAO' ? [{ Codigo: 'E0718', Descricao: 'segredo 12345678000199' }] : [] });
  await request(app()).post('/companies/minha/fechamento/2026-10/conferencia').set('Prefer', 'respond-async').send({}).expect(202);
  expect(fetchDfeNFSe).not.toHaveBeenCalled();
  const r = await execute(jest.fn());
  expect(r.statusCode).toBeGreaterThanOrEqual(400);
  expect(r.body.ok).not.toBe(true);
  expect(r.body.error).toBe(status === 'REJEICAO' ? 'ADN_REJEICAO' : 'ADN_RESPOSTA_INCONCLUSIVA');
  expect(JSON.stringify(r.body)).not.toMatch(/segredo|12345678000199/);
  expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
    expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conferenciaStatus: 'nao_conferivel', conferidaEm: null }) }));
});
test('empresa fora do escopo não aceita tarefa nem consulta', async () => {
  await request(app()).post('/companies/alheia/fechamento/2026-10/conferencia').set('Prefer', 'respond-async').send({}).expect(403);
  expect(start).not.toHaveBeenCalled();
  expect(fetchDfeNFSe).not.toHaveBeenCalled();
});