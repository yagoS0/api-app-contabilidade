import express from 'express';
import request from 'supertest';
import { saldoInicialFluxoRouter } from '../saldoInicialFluxo.js';

jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{
  companyClientUser:{findUnique:jest.fn(async ({where})=>where.companyId_userId.companyId==='permitida'?{role:'FINANCEIRO',status:'ACTIVE'}:null)},
  companyFirmAccess:{findUnique:jest.fn(async()=>({status:'ACTIVE'}))},
}}));

function app({autenticado=true,falhar=false,visitante=false}={}) {
  const a = express();
  const client = {saldoInicialFluxo:{create:jest.fn(async ({data})=>{
    if(falhar)throw new Error('database unavailable');
    return {id:1,...data,criadoEm:new Date()};
  })}};
  a.use(express.json());
  a.use((req,_res,next)=>{if(autenticado)req.auth={user:{id:'usuario-financeiro',role:'client',podeAbrirPortalDoCliente:visitante}};next();});
  a.use(saldoInicialFluxoRouter({client}));
  return {a,client};
}
const url = id => `/companies/${id}/fluxo-de-caixa/saldo-inicial`;
test.each(['put','delete'])('visita do escritório é somente leitura para %s da âncora',async method=>{
  const {a,client}=app({visitante:true});
  expect((await request(a)[method](url('permitida')).send({valor:10,dataReferencia:'2026-09-01'})).status).toBe(403);
  expect(client.saldoInicialFluxo.create).not.toHaveBeenCalled();
});
test('salva pela empresa da rota e autor autenticado, ignorando escopo forjado no corpo',async()=>{
  const {a,client}=app();
  const r=await request(a).put(url('permitida')).send({dataReferencia:'2026-09-01',valor:'100.25',portalClientId:'outra',usuarioId:'outro'});
  expect(r.status).toBe(200);
  expect(r.body.saldoInicial.valor).toBe(100.25);
  expect(client.saldoInicialFluxo.create.mock.calls[0][0].data).toMatchObject({portalClientId:'permitida',criadoPor:'usuario-financeiro'});
});
test.each(['put','delete'])('bloqueia %s fora da empresa autorizada',async method=>{
  const {a,client}=app();
  expect((await request(a)[method](url('outra')).send({valor:10,dataReferencia:'2026-09-01'})).status).toBe(403);
  expect(client.saldoInicialFluxo.create).not.toHaveBeenCalled();
});
test('sem login não escreve',async()=>{
  const {a,client}=app({autenticado:false});
  expect((await request(a).put(url('permitida')).send({})).status).toBe(401);
  expect(client.saldoInicialFluxo.create).not.toHaveBeenCalled();
});
test('validação e falha de gravação não retornam sucesso',async()=>{
  const {a,client}=app();
  expect((await request(a).put(url('permitida')).send({valor:null,dataReferencia:'2026-09-01'})).status).toBe(400);
  expect(client.saldoInicialFluxo.create).not.toHaveBeenCalled();
  const falha=app({falhar:true});
  expect((await request(falha.a).put(url('permitida')).send({valor:10,dataReferencia:'2026-09-01'})).status).toBe(500);
});
test('remover registra evento e não apaga histórico',async()=>{
  const {a,client}=app();
  const r=await request(a).delete(url('permitida'));
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ok:true,saldoInicial:null});
  expect(client.saldoInicialFluxo.create.mock.calls[0][0].data.valor).toBeNull();
});
