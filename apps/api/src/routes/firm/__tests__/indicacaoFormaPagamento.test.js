jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
jest.mock('../../../application/accounting/parcelamento/IndicacaoFormaPagamentoService.js', () => ({ listarFormasIndicacoes: jest.fn(), salvarFormaIndicacao: jest.fn() }));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createParcelamentosAcompanhamentoRouter } from '../parcelamentosAcompanhamento.js';
import { listarFormasIndicacoes, salvarFormaIndicacao } from '../../../application/accounting/parcelamento/IndicacaoFormaPagamentoService.js';
const base = '/firm/companies/c/parcelamentos/acompanhamento/indicacoes';
function app(user = { id: 'u', role: 'staff' }) { const a = express(); a.use(express.json()); a.use((req, res, next) => { req.auth = { user }; next(); }); a.use('/firm', createParcelamentosAcompanhamentoRouter()); return a; }
beforeEach(() => { jest.clearAllMocks(); prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'ACCOUNTANT' }); listarFormasIndicacoes.mockResolvedValue({ items: [] }); salvarFormaIndicacao.mockResolvedValue({ revision: 'r' }); });
test('GET só lê configurações no escopo autorizado; não reprocessa nem salva', async () => {
 const r = await request(app()).get(`${base}/formas?mes=2026-10&companyId=other`);
 expect(r.status).toBe(200); expect(r.body.canEdit).toBe(true); expect(listarFormasIndicacoes).toHaveBeenCalledWith(prisma, 'c', '2026-10'); expect(salvarFormaIndicacao).not.toHaveBeenCalled();
});
test('escrita usa ator autenticado e identidade da rota; STAFF e sessão ausente são recusados', async () => {
 const body = { userId: 'attacker', role: 'admin', companyId: 'other' };
 expect((await request(app()).post(`${base}/i/forma`).send(body)).status).toBe(200);
 expect(salvarFormaIndicacao).toHaveBeenCalledWith(prisma, 'c', 'i', { id: 'u', role: 'staff' }, body);
 prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'STAFF' });
 expect((await request(app()).post(`${base}/i/forma`).send(body)).status).toBe(403);
 expect((await request(app(null)).post(`${base}/i/forma`).send(body)).status).toBe(401);
 expect(salvarFormaIndicacao).toHaveBeenCalledTimes(1);
});
