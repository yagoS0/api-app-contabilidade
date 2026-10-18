jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
import express from 'express';
import request from 'supertest';
import { createWhatsappTesteIaRouter } from '../whatsappTesteIa.js';
const montar=(user,servico)=>{
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.auth={user};next();});app.use(createWhatsappTesteIaRouter({servico}));return app;
};
test('rotas recusam visitante e usuário sem administrador antes do serviço',async()=>{
 const ativar=jest.fn();
 for(const user of [null,{id:'staff',role:'contador'}]){
   const app=montar(user,{ativar});expect((await request(app).post('/whatsapp/teste-ia').send({})).status).toBe(403);
 }
 expect(ativar).not.toHaveBeenCalled();
});
test('ator não pode ser substituído pelo corpo e GET somente consulta',async()=>{
 const user={id:'admin',role:'admin'},ativar=jest.fn(async()=>({id:'sessao'})),consultar=jest.fn(async()=>({id:'sessao'}));
 const app=montar(user,{ativar,consultar});
 expect((await request(app).post('/whatsapp/teste-ia').send({user:{id:'outro'},telefone:'5500000000000'})).status).toBe(200);
 expect(ativar.mock.calls[0][0].user).toEqual(user);
 expect((await request(app).get('/whatsapp/teste-ia/sessao')).status).toBe(200);expect(ativar).toHaveBeenCalledTimes(1);expect(consultar).toHaveBeenCalledWith({user,id:'sessao'});
});
