jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import express from 'express';
import request from 'supertest';
import { createFluxoComercialRouter } from '../fluxoComercial.js';

function fixture(role = 'contador') {
  const db = {
    atendimentoLead: { findFirst: jest.fn(async () => null), create: jest.fn() },
    onboarding: { findUnique: jest.fn(async () => ({ id: 'f', status: 'RASCUNHO' })) },
    canalWhatsapp: { findMany: jest.fn(async () => []) },
  };
  db.$transaction = jest.fn(fn => fn(db));
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.auth = { user: { id: 'ator', role } }; next(); });
  const escopo = jest.fn(async () => []);
  app.use('/comercial', createFluxoComercialRouter({ db, escopo }));
  return { app, db, escopo };
}
test.each(['cliente', 'operador', ''])('novo comando não amplia papel %s', async role => {
  const t = fixture(role);
  const r = await request(t.app).post('/comercial/onboardings/f/contato/vincular').send({ neutro: false });
  expect(r.status).toBe(403);
  expect(t.db.$transaction).not.toHaveBeenCalled();
  expect(t.escopo).not.toHaveBeenCalled();
});
test.each(['contato', 'contato/vincular'])('porta %s conserva validação e erros legíveis', async path => {
  const t = fixture();
  const r = await request(t.app).post('/comercial/onboardings/f/' + path).send({ nome: 'Sintético', telefone: '5521999991234', autorizado: false });
  expect(r.status).toBe(400);
  expect(r.body).toMatchObject({ ok: false, error: 'autorizacao_obrigatoria' });
  expect(r.headers['cache-control']).toBe('no-store');
  expect(t.db.$transaction).not.toHaveBeenCalled();
});
test('canal revogado não cria vínculo mesmo com flags forjadas', async () => {
  const t = fixture();
  const r = await request(t.app).post('/comercial/onboardings/f/contato/vincular').send({ nome: 'Sintético', telefone: '5521999991234', autorizado: true, evidencia: 'Formulário sintético', canalId: 'revogado', assumir: true });
  expect(r.status).toBe(409);
  expect(r.body.error).toBe('canal_comercial_indefinido');
  expect(t.db.atendimentoLead.create).not.toHaveBeenCalled();
});
