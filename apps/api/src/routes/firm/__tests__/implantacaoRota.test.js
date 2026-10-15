import express from 'express';
import request from 'supertest';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createImplantacaoRouter } from '../implantacao.js';
const ler = jest.fn(async () => ({ tarefas: [], resumo: {} })), salvar = jest.fn(async () => ({ tarefas: [] }));
function app(user = { id: 'u1', role: 'contador' }) {
  const a = express(); a.use(express.json()); a.use((req, res, next) => { req.auth = { user }; next(); });
  a.use('/companies/:companyId', createImplantacaoRouter({ ler, salvar })); return a;
}
beforeEach(() => { jest.clearAllMocks(); prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] }); });
test('empresa sem vínculo é recusada antes da leitura', async () => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue(null);
  expect((await request(app()).get('/companies/outra/implantacao')).status).toBe(403);
  expect(ler).not.toHaveBeenCalled();
});
test('staff pode ler mas não editar; retorna capacidade real', async () => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'STAFF', status: 'ACTIVE' });
  const r = await request(app()).get('/companies/p1/implantacao');
  expect(r.body.implantacao.podeEditar).toBe(false);
  expect((await request(app()).patch('/companies/p1/implantacao/documentos').send({})).status).toBe(403);
  expect(salvar).not.toHaveBeenCalled();
});
test('usa empresa da URL e ator autenticado', async () => {
  expect((await request(app()).patch('/companies/p1/implantacao/documentos').send({ versao: 0 })).status).toBe(200);
  expect(salvar).toHaveBeenCalledWith('p1', 'documentos', { versao: 0 }, 'u1');
});
test('falha de armazenamento não expõe mensagem interna nem simula sucesso', async () => {
  ler.mockRejectedValueOnce(new Error('connection secret'));
  const r = await request(app()).get('/companies/p1/implantacao');
  expect(r.status).toBe(503); expect(r.body.message).not.toContain('secret');
});
