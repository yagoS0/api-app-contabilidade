jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../empresasVisiveis.js',()=>({empresasVisiveis:jest.fn(async()=>['permitida'])}));
import express from 'express';
import request from 'supertest';
import { createAgendaRouter } from '../agenda.js';
import { createObrigacoesRouter } from '../obrigacoes.js';
import { createCalendarioRouter } from '../calendario.js';
function app(usuario='u') {
  const a=express(); a.use(express.json());
  a.use((req,res,next)=>{req.auth={user:usuario?{id:usuario}:null};next();});
  a.use(createAgendaRouter()); a.use(createObrigacoesRouter()); a.use(createCalendarioRouter());
  return a;
}
test.each([
 ['get','/agenda/tarefas'], ['post','/agenda/tarefas'], ['patch','/agenda/tarefas/old'],
 ['post','/agenda/tarefas-empresas'], ['post','/agenda/ocorrencias/restaurar'],
 ['post','/agenda/ocorrencias/editar'], ['post','/agenda/series/excluir'],
 ['get','/agenda/ocorrencias/excluidas'], ['get','/agenda/carteira'],
 ['get','/calendario'], ['get','/obrigacoes'], ['patch','/obrigacoes/old'],
 ['post','/companies/empresa/obrigacoes'], ['post','/regras-obrigacao'],
 ['post','/regras-obrigacao/old/excecoes'], ['post','/ocorrencias/old/reabrir'],
])('%s %s cannot access or recreate the removed calendar',async(method,url)=>{
 const result=await request(app())[method](url).send({});
 expect(result.status).toBe(410);
 expect(result.body.error).toBe('CALENDARIO_LEGADO_REMOVIDO');
});
test('removed routes still require authentication',async()=>{
 expect((await request(app(null)).post('/agenda/tarefas').send({})).status).toBe(401);
});
test('new calendar retains its own authentication instead of legacy tombstone',async()=>{
 expect((await request(app(null)).get('/agenda/unificada')).status).toBe(401);
});
