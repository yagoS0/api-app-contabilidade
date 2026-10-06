jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: { user: { findUnique: jest.fn() } } }));
jest.mock('../middlewares/portalAccess.js', () => ({ ensureLegacyCompanyAccess: jest.fn(), resolveLegacyCompanyId: jest.fn() }));
jest.mock('../middlewares/emissaoNfseGate.js', () => ({ ensureEmissaoNfseAutorizada: jest.fn() }));
jest.mock('../../application/nfse/NfseRecorrenciaService.js', () => ({ criarRecorrencia: jest.fn(), listarRecorrencias: jest.fn(), pausarRecorrencia: jest.fn(), retomarRecorrencia: jest.fn() }));
import express from 'express';
import request from 'supertest';
import { createNfseRecorrenciasRouter, autorizarExecucaoRecorrente } from '../nfseRecorrencias.js';
import { ensureLegacyCompanyAccess, resolveLegacyCompanyId } from '../middlewares/portalAccess.js';
import { ensureEmissaoNfseAutorizada } from '../middlewares/emissaoNfseGate.js';
import { criarRecorrencia, pausarRecorrencia } from '../../application/nfse/NfseRecorrenciaService.js';
import { prisma } from '../../infrastructure/db/prisma.js';
let app;
beforeEach(() => {
  jest.clearAllMocks();
  resolveLegacyCompanyId.mockResolvedValue('legada');
  ensureLegacyCompanyAccess.mockResolvedValue({ ok: true });
  ensureEmissaoNfseAutorizada.mockResolvedValue({ ok: true });
  app = express(); app.use(express.json());
  app.use('/recorrencias', createNfseRecorrenciasRouter({ ensureAuthorized: async req => { req.auth = { user: { id: 'usuario' } }; return true; } }));
});
test('resolve empresa e registra o usuário autenticado, ignorando ator do corpo', async () => {
  criarRecorrencia.mockResolvedValue({ id: 'nova' });
  await request(app).post('/recorrencias').send({ companyId: 'portal', userId: 'outro' }).expect(201);
  expect(criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'legada', userId: 'usuario' }));
});
test('recusa acesso antes de salvar', async () => {
  ensureLegacyCompanyAccess.mockImplementation(async (req, res) => { res.status(403).json({ error: 'forbidden' }); return { ok: false }; });
  await request(app).post('/recorrencias').send({ companyId: 'outra' }).expect(403);
  expect(criarRecorrencia).not.toHaveBeenCalled();
});
test('exige permissão de emissão para criar agendamento', async () => {
  ensureEmissaoNfseAutorizada.mockImplementation(async (req, res) => { res.status(403).json({ error: 'blocked' }); return { ok: false }; });
  await request(app).post('/recorrencias').send({ companyId: 'portal' }).expect(403);
  expect(criarRecorrencia).not.toHaveBeenCalled();
});
test('pausa é limitada à empresa autorizada', async () => {
  pausarRecorrencia.mockResolvedValue(false);
  await request(app).post('/recorrencias/rec-outra/pausar').send({ companyId: 'portal' }).expect(404);
  expect(pausarRecorrencia).toHaveBeenCalledWith('legada', 'rec-outra');
});
test('usuário desativado não mantém autorização no worker', async () => {
  prisma.user.findUnique.mockResolvedValue({ id: 'usuario', status: 'disabled' });
  expect(await autorizarExecucaoRecorrente({ autorizadoPor: 'usuario', companyId: 'legada' })).toBe(false);
  expect(ensureLegacyCompanyAccess).not.toHaveBeenCalled();
});
