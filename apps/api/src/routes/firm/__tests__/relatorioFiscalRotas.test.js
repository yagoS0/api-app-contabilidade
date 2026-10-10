import express from 'express';
import request from 'supertest';
import { createFluxoComercialRouter } from '../fluxoComercial.js';
import { criarRelatorioFiscalLead } from '../../../application/onboarding/RelatorioFiscalLeadService.js';
import { OnboardingError } from '../../../application/onboarding/OnboardingService.js';

jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../../application/onboarding/RelatorioFiscalLeadService.js', () => ({ criarRelatorioFiscalLead: jest.fn() }));

function setup(role = 'contador') {
  const fiscal = { carregar: jest.fn(async () => ({ relatorios: [] })), tabela: jest.fn(async () => Buffer.from('%PDF-sintetico')), revisar: jest.fn(async () => ({ revisadoEm: '2026-10-10' })), enviar: jest.fn(async () => ({ envio: { estado: 'ENVIADO' } })) };
  criarRelatorioFiscalLead.mockReturnValue(fiscal);
  const db = { atendimentoLead: { findFirst: jest.fn(async () => ({ conversaId: 'c' })) }, conversaWhatsapp: { findUnique: jest.fn(async () => ({ id: 'c' })) } };
  const user = { id: 'contador', role };
  const app = express(); app.use(express.json()); app.use((req,res,next) => { req.auth = { user }; next(); });
  app.use('/comercial', createFluxoComercialRouter({ db, escopo: async () => [] }));
  return { app, fiscal, user };
}

test('painel e PDF fiscal não são armazenáveis e hash chega intacto ao serviço', async () => {
  const t = setup();
  const panel = await request(t.app).get('/comercial/onboardings/o/fiscal');
  expect(panel.status).toBe(200); expect(panel.headers['cache-control']).toBe('no-store');
  const pdf = await request(t.app).get('/comercial/onboardings/o/fiscal/a/tabela.pdf').query({ conteudoHash: 'abc123' });
  expect(pdf.status).toBe(200); expect(pdf.headers['cache-control']).toBe('no-store');
  expect(pdf.headers['content-type']).toContain('application/pdf');
  expect(pdf.headers['content-disposition']).toBe('inline; filename="situacao-fiscal-tabela.pdf"');
  expect(t.fiscal.tabela).toHaveBeenCalledWith('o','a',t.user,'abc123');
});

test.each(['get','post'])('papel de cliente não alcança serviço fiscal via %s', async method => {
  const t = setup('cliente');
  const path = method === 'get' ? '/comercial/onboardings/o/fiscal' : '/comercial/onboardings/o/fiscal/a/enviar';
  const r = await request(t.app)[method](path);
  expect(r.status).toBe(403); expect(r.body.ok).toBe(false);
  expect(t.fiscal.carregar).not.toHaveBeenCalled(); expect(t.fiscal.enviar).not.toHaveBeenCalled();
});

test.each(['revisao','enviar'])('POST %s preserva conflito de domínio e não retorna sucesso', async acao => {
  const t = setup(); const fn = acao === 'revisao' ? t.fiscal.revisar : t.fiscal.enviar;
  fn.mockRejectedValue(new OnboardingError('relatorio_alterado','Abra e confira novamente.',409));
  const body = { versao: 3, conteudoHash: 'antigo', conversaId: 'c' };
  const r = await request(t.app).post('/comercial/onboardings/o/fiscal/a/'+acao).send(body);
  expect(r.status).toBe(409); expect(r.headers['cache-control']).toBe('no-store');
  expect(r.body).toMatchObject({ ok: false, error: 'relatorio_alterado' });
  expect(fn).toHaveBeenCalledWith('o','a',t.user,body);
});

test('PDF com hash obsoleto responde JSON409 sem fingir PDF', async () => {
 const t=setup(); t.fiscal.tabela.mockRejectedValue(new OnboardingError('relatorio_alterado','Atualize.',409));
 const r=await request(t.app).get('/comercial/onboardings/o/fiscal/a/tabela.pdf').query({conteudoHash:'velho'});
 expect(r.status).toBe(409); expect(r.headers['content-type']).toContain('application/json');
 expect(r.headers['cache-control']).toBe('no-store'); expect(r.body.error).toBe('relatorio_alterado');
});
