import express from 'express';
import request from 'supertest';
import { createEnsureAuthorized } from '../middlewares/auth.js';
jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: {
  company: { findMany: jest.fn(), findUnique: jest.fn() },
  portalClient: { findMany: jest.fn(), findUnique: jest.fn() },
  companyClientUser: { findMany: jest.fn(), findUnique: jest.fn() },
  companyFirmAccess: { findMany: jest.fn(), findUnique: jest.fn() },
  $transaction: async ops => Promise.all(ops),
} }));
jest.mock('../../application/nfse/NfseService.js', () => ({ NfseService: { sendEvent: jest.fn() } }));
jest.mock('../../infrastructure/db/NfseRepository.js', () => ({ NfseRepository: {
  findByChaveAcesso: jest.fn(), updateByChaveAcesso: jest.fn(),
} }));
import { prisma } from '../../infrastructure/db/prisma.js';
import { NfseService } from '../../application/nfse/NfseService.js';
import { NfseRepository } from '../../infrastructure/db/NfseRepository.js';
import { createNfseRouter } from '../nfse.js';

const CHAVE = '3'.repeat(50);
const body = { tipoEvento: 'e101101', cMotivo: '1', justificativa: 'Justificativa sintética para teste' };
let usuario, vinculo, antesDaRevalidacao, post;
function app() {
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  // Middleware canônico real; apenas repositório/token são doubles de transporte/autenticação.
  const AuthService = { isEnabled: () => true, verifyToken: token => { if (token !== 'sessao-sintetica') throw new Error('invalid'); return { sub: 'u' }; }, resolveUserFromPayload: async () => usuario };
  const ensureAuthorized = createEnsureAuthorized({ AuthService, log });
  const server = express(); server.use(express.json()); server.use('/nfse', createNfseRouter({ ensureAuthorized, log })); return server;
}
const enviar = (token = 'sessao-sintetica') => { const req = request(app()).post(`/nfse/${CHAVE}/eventos`); if (token) req.set('Authorization', `Bearer ${token}`); return req.send(body); };
beforeEach(() => {
  jest.clearAllMocks(); usuario = { id: 'u', status: 'active', role: 'staff' }; vinculo = 'ACTIVE'; antesDaRevalidacao = () => {}; post = jest.fn();
  prisma.company.findMany.mockResolvedValue([]);
  prisma.companyFirmAccess.findMany.mockImplementation(async () => vinculo === 'ACTIVE' ? [{ companyId: 'portal-a' }] : []);
  prisma.companyClientUser.findMany.mockResolvedValue([]);
  prisma.portalClient.findMany.mockImplementation(async () => vinculo === 'ACTIVE' ? [{ companyId: 'empresa-a' }] : []);
  prisma.portalClient.findUnique.mockResolvedValue({ id: 'portal-a', companyId: 'empresa-a', emissaoClienteLiberada: true });
  prisma.companyFirmAccess.findUnique.mockImplementation(async () => ({ status: vinculo, role: 'OWNER' }));
  prisma.companyClientUser.findUnique.mockResolvedValue(null);
  NfseRepository.findByChaveAcesso.mockResolvedValue({ id: 'nf-a', companyId: 'empresa-a', status: 'issued' });
  NfseService.sendEvent.mockImplementation(async ({ revalidarAutorizacao }) => { antesDaRevalidacao(); await revalidarAutorizacao(); post(); return { confirmacaoFiscal: true, status: 'cancelled', nfse: { id: 'nf-a', status: 'cancelled' } }; });
});
it('vínculo vigente permite resposta comprovada sem escrita duplicada na rota', async () => { const r = await enviar(); expect(r.status).toBe(200); expect(r.body.status).toBe('cancelled'); expect(post).toHaveBeenCalledTimes(1); expect(NfseRepository.updateByChaveAcesso).not.toHaveBeenCalled(); });
it('sem autenticação não chega ao serviço', async () => { expect((await enviar(null)).status).toBe(401); expect(NfseService.sendEvent).not.toHaveBeenCalled(); });
it('empresa diferente não chega ao serviço', async () => { NfseRepository.findByChaveAcesso.mockResolvedValue({ companyId: 'empresa-b', status: 'issued' }); expect((await enviar()).status).toBe(403); expect(NfseService.sendEvent).not.toHaveBeenCalled(); });
it.each(['INACTIVE', 'REVOKED'])('vínculo %s não despacha', async estado => { vinculo = estado; expect((await enviar()).status).toBe(403); expect(post).not.toHaveBeenCalled(); });
it('revogação do vínculo durante preparação bloqueia antes da rede', async () => { antesDaRevalidacao = () => { vinculo = 'REVOKED'; }; expect((await enviar()).status).toBe(403); expect(post).not.toHaveBeenCalled(); });
it('sessão revogada durante preparação é relida pelo middleware', async () => { antesDaRevalidacao = () => { usuario = null; }; expect((await enviar()).status).toBe(401); expect(post).not.toHaveBeenCalled(); });
it('usuário desativado durante preparação é recusado', async () => { antesDaRevalidacao = () => { usuario.status = 'inactive'; }; expect((await enviar()).status).toBe(403); expect(post).not.toHaveBeenCalled(); });
it('papel global segue política existente, mas deve permanecer ativo', async () => { usuario.role = 'admin'; vinculo = 'INACTIVE'; expect((await enviar()).status).toBe(200); });
it('accepted sem prova não vira sucesso nem escrita', async () => { NfseService.sendEvent.mockResolvedValue({ status: 'accepted' }); const r = await enviar(); expect(r.status).toBe(502); expect(r.body.podeTentarDeNovo).toBe(false); expect(NfseRepository.updateByChaveAcesso).not.toHaveBeenCalled(); });
it.each(['PENDENTE', 'INDEFERIDO', 'INCONCLUSIVO'])('preserva mensagem do desfecho %s sem cancelamento', async situacao => { NfseService.sendEvent.mockRejectedValue(Object.assign(new Error(`Resultado ${situacao}`), { camada: 'TRANSPORTE', codigo: 'NFSE_CANCELAMENTO_NAO_CONFIRMADO', situacao })); const r = await enviar(); expect(r.status).toBe(502); expect(r.body.message).toContain(situacao); expect(NfseRepository.updateByChaveAcesso).not.toHaveBeenCalled(); });
