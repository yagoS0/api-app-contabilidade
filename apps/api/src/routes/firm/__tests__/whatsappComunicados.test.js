import express from 'express';
import request from 'supertest';
import { createWhatsappComunicadosRouter } from '../whatsappComunicados.js';
const criar = (role = 'contador') => {
  const servico = Object.fromEntries(['listar', 'audiencia', 'criar', 'detalhe', 'submeter', 'consultar', 'confirmar', 'cancelar'].map(k => [k, jest.fn().mockResolvedValue({ ok: true })]));
  const escopo = jest.fn().mockResolvedValue(['empresa-visivel']);
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.auth = { user: { id: 'operador', role } }; next(); });
  app.use('/firm', createWhatsappComunicadosRouter({ servico, escopo, log: { error() {} } }));
  return { app, servico, escopo };
};
test('cliente não lista nem inicia transmissão', async () => {
  const { app, escopo } = criar('user');
  expect((await request(app).get('/firm/whatsapp/comunicados')).status).toBe(403);
  expect((await request(app).post('/firm/whatsapp/comunicados/aviso/enviar').send({})).status).toBe(403);
  expect(escopo).not.toHaveBeenCalled();
});
test('prévia só consulta audiência e confirmação passa escopo, hash e usuário autenticado', async () => {
  const { app, servico } = criar();
  await request(app).post('/firm/whatsapp/comunicados/previa').send({ empresasIds: ['empresa-visivel'] }).expect(200);
  expect(servico.audiencia).toHaveBeenCalledWith({ empresasIds: ['empresa-visivel'] }, ['empresa-visivel']);
  expect(servico.confirmar).not.toHaveBeenCalled();
  await request(app).post('/firm/whatsapp/comunicados/aviso/enviar').send({ previaHash: 'hash', userId: 'falso' }).expect(200);
  expect(servico.confirmar).toHaveBeenCalledWith('aviso', ['empresa-visivel'], 'hash', 'operador');
});
test('falha interna não vaza detalhes e conflito preserva instrução útil', async () => {
  const { app, servico } = criar();
  servico.detalhe.mockRejectedValue(new Error('detalhe secreto'));
  const erro = await request(app).get('/firm/whatsapp/comunicados/aviso').expect(500);
  expect(JSON.stringify(erro.body)).not.toContain('secreto');
  servico.confirmar.mockRejectedValue(Object.assign(new Error('Revise a prévia.'), { status: 409 }));
  const conflito = await request(app).post('/firm/whatsapp/comunicados/aviso/enviar').send({}).expect(409);
  expect(conflito.body.message).toBe('Revise a prévia.');
});
