jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import express from 'express';
import request from 'supertest';
import { createFluxoComercialRouter } from '../fluxoComercial.js';

function app(role = 'contador') {
  const db = { atendimentoLead: { findFirst: jest.fn(async () => null) } };
  const a = express(); a.use(express.json());
  a.use((req, res, next) => { req.auth = { user: { id: 'contador-sintetico', role } }; next(); });
  a.use('/comercial', createFluxoComercialRouter({ db }));
  return { a, db };
}

test.each(['cadastro', 'cadastro/consulta', 'procuracao/manual', 'jornada/fiscal-alternativa', 'jornada/cobranca-externa', 'jornada/pagamento', 'jornada/cobranca-envio', 'documentos-chat', 'contratos/contrato/enviar', 'apresentacao/diagnostico/enviar', 'apresentacao/diagnostico/conferir'])('POST %s rejeita papel do cliente antes de ler dados', async caminho => {
  const t = app('cliente');
  const r = await request(t.a).post('/comercial/onboardings/o/' + caminho).send({});
  expect(r.status).toBe(403); expect(r.body.ok).toBe(false);
  expect(t.db.atendimentoLead.findFirst).not.toHaveBeenCalled();
});

test.each(['apresentacao', 'apresentacao/diagnostico/pdf', 'documentos-chat', 'contratos/contrato/envio'])('GET %s não expõe documentos a cliente sem papel de gestão', async caminho => {
  const t = app('cliente');
  const r = await request(t.a).get('/comercial/onboardings/o/' + caminho);
  expect(r.status).toBe(403);
  expect(t.db.atendimentoLead.findFirst).not.toHaveBeenCalled();
});

test.each([
  ['procuracao/manual', 'validacao_invalida'],
  ['jornada/fiscal-alternativa', 'fiscal_alternativa_invalida'],
  ['jornada/cobranca-externa', 'cobranca_invalida'],
  ['jornada/pagamento', 'pagamento_incompleto'],
])('POST %s valida payload e mantém erro de domínio', async (caminho, codigo) => {
  const t = app();
  const r = await request(t.a).post('/comercial/onboardings/o/' + caminho).send({});
  expect([400, 409]).toContain(r.status);
  expect(r.body).toMatchObject({ ok: false, error: codigo });
  expect(r.headers['cache-control']).toBe('no-store');
});

test('fiscal pulado não exige narrativa, mas exige versão válida', async () => {
  const t = app();
  const r = await request(t.a).post('/comercial/onboardings/o/jornada/fiscal-alternativa').send({ modo: 'PULADA', versao: '2' });
  expect(r.status).toBe(409); expect(r.body.error).toBe('fiscal_alternativa_invalida');
});
