import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import express from 'express';
import request from 'supertest';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  companyClientUser: { findUnique: jest.fn() }, companyFirmAccess: { findUnique: jest.fn() },
  guide: { findFirst: jest.fn() },
} }));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { requireClientCompanyAccess } from '../../../middlewares/requireClientCompanyAccess.js';
import { lerDataDoPagamentoInformada, FRASE_DA_RECUSA } from '../../../application/guides/lib/dataDoPagamento.js';

// Executa o handler real e o middleware real em HTTP. O restante do router não é inicializado;
// efeitos financeiros são comprovados pelo serviço e pelo ensaio PostgreSQL separado.
const fonte = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const start = fonte.lastIndexOf('  router.post(', fonte.indexOf('"/companies/:companyId/guides/:guideId/confirmar-pagamento"'));
const end = fonte.indexOf('\n  );', start) + '\n  );'.length;
const markGuidePaidByCliente = jest.fn();
function app(user = { id: 'u', role: 'client' }) {
  const router = express.Router();
  vm.runInNewContext(fonte.slice(start, end), { router, prisma, requireClientCompanyAccess,
    lerDataDoPagamentoInformada, FRASE_DA_RECUSA, markGuidePaidByCliente,
    toGuideResponse: g => ({ guideId: g.id }), PUBLICO: { CLIENTE: 'CLIENTE' } });
  const server = express(); server.use(express.json());
  server.use((req, _res, next) => { req.auth = { user }; next(); }); server.use(router); return server;
}
beforeEach(() => {
  jest.clearAllMocks();
  prisma.companyClientUser.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'FINANCEIRO' });
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'ACTIVE' });
  prisma.guide.findFirst.mockResolvedValue({ id: 'g', portalClientId: 'c', liberadaCliente: true });
  markGuidePaidByCliente.mockResolvedValue({ ok: true, guide: { id: 'g' }, confirmacao: { id: 'log', estadoBaixa: 'CONCLUIDA' }, aviso: 'Baixa registrada.' });
});
const post = server => request(server).post('/companies/c/guides/g/confirmar-pagamento').send({ pagoEm: '2026-09-20', versaoPagamento: 'v1', eventoId: 'evento' });

test('portal passa identidade autenticada, empresa, data e revisão ao serviço', async () => {
  const r = await post(app()); expect(r.status).toBe(200);
  expect(markGuidePaidByCliente).toHaveBeenCalledWith({ companyId: 'c', guideId: 'g', userId: 'u',
    pagoEm: new Date('2026-09-20'), reconfirmaConfirmacaoId: undefined, expectedVersion: 'v1', eventId: 'evento' });
  expect(r.body.confirmacao).toEqual({ id: 'log', estadoBaixa: 'CONCLUIDA' });
});
test('sem autenticação ou vínculo ativo não chega à escrita', async () => {
  expect((await post(app(null))).status).toBe(401);
  prisma.companyClientUser.findUnique.mockResolvedValue(null);
  expect((await post(app())).status).toBe(403); expect(markGuidePaidByCliente).not.toHaveBeenCalled();
});
test('visita do contador não declara pagamento como cliente', async () => {
  expect((await post(app({ id: 'f', role: 'accountant', podeAbrirPortalDoCliente: true }))).status).toBe(403);
  expect(markGuidePaidByCliente).not.toHaveBeenCalled();
});
test('guia não liberada/ausente recusa antes do serviço', async () => {
  prisma.guide.findFirst.mockResolvedValue(null);
  expect((await post(app())).status).toBe(404);
  expect(prisma.guide.findFirst).toHaveBeenCalledWith({ where: { id: 'g', portalClientId: 'c', liberadaCliente: true } });
  expect(markGuidePaidByCliente).not.toHaveBeenCalled();
});
test('pendência retorna explicitamente e conflito não vira sucesso', async () => {
  markGuidePaidByCliente.mockResolvedValueOnce({ ok: true, guide: { id: 'g' }, confirmacao: { id: 'log', estadoBaixa: 'PENDENTE', motivo: 'MES_FECHADO' } });
  expect((await post(app())).body.confirmacao.estadoBaixa).toBe('PENDENTE');
  markGuidePaidByCliente.mockRejectedValueOnce(Object.assign(Error('Guia mudou.'), { code: 'GUIA_ALTERADA' }));
  const r = await post(app()); expect(r.status).toBe(409); expect(r.body.ok).toBe(false);
});

test('reconfirmação envia referência explícita ao serviço e conflito retorna 409',async()=>{const server=app();await request(server).post('/companies/c/guides/g/confirmar-pagamento').send({pagoEm:'2026-09-20',versaoPagamento:'v2',reconfirmaConfirmacaoId:'anterior'});expect(markGuidePaidByCliente).toHaveBeenCalledWith(expect.objectContaining({reconfirmaConfirmacaoId:'anterior',expectedVersion:'v2'}));markGuidePaidByCliente.mockRejectedValueOnce(Object.assign(Error('Indisponível'),{code:'RECONFIRMACAO_INDISPONIVEL'}));expect((await post(server)).status).toBe(409);});
