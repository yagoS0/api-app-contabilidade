import express from 'express';
import request from 'supertest';
jest.mock('../../application/tomador/consultaCnpjRuntime.js',()=>({consultarCnpjComCache:jest.fn()}));
jest.mock('../../application/nfse/lote/municipiosIbge.js',()=>({municipiosIbgeOuNulo:async()=>[]}));
import { criarRotasConsultaCnpj } from '../consultaCnpjHttp.js';
function app({user={id:'u'},permitirCadastro=true,permitirEmpresa=true}={}) {
  const consultar=jest.fn().mockResolvedValue({ok:true});const a=express();a.use(express.json());
  a.use((req,res,next)=>{req.auth={user};next();});
  a.use(criarRotasConsultaCnpj({permitirCadastro,consultar,lerConsumo:async()=>[],empresaAccess:(req,res,next)=>permitirEmpresa?next():res.sendStatus(403)}));
  return {a,consultar};
}
test('emissor impõe escopo e finalidade, sem aceitar modalidade do navegador',async()=>{
  const {a,consultar}=app();await request(a).post('/companies/pc/consulta-cnpj').send({cnpj:'11222333000181'}).expect(200);
  expect(consultar).toHaveBeenCalledWith('11222333000181',expect.objectContaining({escopo:'empresa:pc',finalidade:'EMISSOR'}));
  await request(a).post('/companies/pc/consulta-cnpj').send({cnpj:'11222333000181',habilitarPago:true}).expect(400);
  expect(consultar).toHaveBeenCalledTimes(1);
});
test('sem acesso à empresa não consulta',async()=>{
  const {a,consultar}=app({permitirEmpresa:false});await request(a).post('/companies/pc/consulta-cnpj').send({cnpj:'11222333000181'}).expect(403);expect(consultar).not.toHaveBeenCalled();
});
test('cadastro inicial gratuito e cadastro efetivo usam finalidades distintas',async()=>{
  const {a,consultar}=app();await request(a).post('/cadastro/consulta-cnpj').send({cnpj:'11222333000181'}).expect(200);
  expect(consultar).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({escopo:'conta:u',finalidade:'PUBLICO'}));
  await request(a).post('/cadastro/consulta-cnpj-completa').send({cnpj:'11222333000181'}).expect(200);
  expect(consultar).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({finalidade:'CADASTRO'}));
});
test('porta do cliente não expõe cadastro completo',async()=>{
  const {a,consultar}=app({permitirCadastro:false});await request(a).post('/cadastro/consulta-cnpj-completa').send({cnpj:'11222333000181'}).expect(404);expect(consultar).not.toHaveBeenCalled();
});
test('sem usuário não consulta',async()=>{
  const {a,consultar}=app({user:null});await request(a).post('/cadastro/consulta-cnpj').send({cnpj:'11222333000181'}).expect(401);expect(consultar).not.toHaveBeenCalled();
});
test('consumo global só é visível ao administrador e informa bloqueio pago',async()=>{
  await request(app().a).get('/cadastro/consumo-cnpj').expect(403);
  const r=await request(app({user:{id:'admin',role:'admin'}}).a).get('/cadastro/consumo-cnpj').expect(200);
  expect(r.body).toEqual({pagoHabilitadoNoRuntime:false,consumo:[]});
});
