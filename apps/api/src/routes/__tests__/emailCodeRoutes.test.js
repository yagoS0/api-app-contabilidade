jest.mock('../../config.js',()=>({JWT_SECRET:'test-email',REFRESH_TOKEN_EXPIRES_IN:'7d'}));
jest.mock('../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../../infrastructure/mail/EmailService.js',()=>({EmailService:class {}}));
import express from 'express';
import request from 'supertest';
import {createEmailLoginRouter} from '../emailLogin.js';
function app(service={},mailReady=()=>true){
 const send=jest.fn(),log={error:jest.fn()};
 const a=express();a.use(express.json());a.use(createEmailLoginRouter({service,send,mailReady,log,AuthService:{isEnabled:()=>true,generateToken:()=> 'access'}}));return {a,send,log};
}
test('pedido nunca devolve código nem existência e não aguarda transporte',async()=>{
 let finish;const service={solicitar:jest.fn(async()=>({challengeId:'a'.repeat(64),expiresIn:600,resendAfter:60,delivery:{to:'private@example.com',code:'12345678'}}))};
 const {a,send}=app(service);send.mockImplementation(()=>new Promise(r=>{finish=r;}));
 const r=await request(a).post('/email-code/request').send({email:'private@example.com'});
 expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(JSON.stringify(r.body)).not.toMatch(/12345678|private@example/);finish();
});
test('sem configuração não procura conta; tipos inválidos não chegam ao serviço',async()=>{
 const service={solicitar:jest.fn()};const {a}=app(service,()=>false);
 expect((await request(a).post('/email-code/request').send({email:'a@b.com'})).status).toBe(503);expect(service.solicitar).not.toHaveBeenCalled();
 const b=app(service).a;expect((await request(b).post('/email-code/request').send({email:{x:1}})).status).toBe(400);
});
test('código recusado não emite tokens; sucesso não serializa hash nem dados internos',async()=>{
 const service={confirmar:jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({user:{id:'u',name:'Cliente',role:'user',passwordHash:'private-hash'},refreshToken:'refresh'})};
 const {a}=app(service);
 expect((await request(a).post('/email-code/verify').send({challengeId:'id',code:'bad'})).status).toBe(401);
 const r=await request(a).post('/email-code/verify').send({challengeId:'id',code:'12345678'});expect(r.status).toBe(200);expect(r.body.user.accountType).toBe('CLIENT');expect(JSON.stringify(r.body)).not.toContain('private-hash');
});
test('limite por origem para pedidos e logs sem credenciais quando transporte falha',async()=>{
 const service={solicitar:jest.fn(async()=>({challengeId:'a'.repeat(64),delivery:{to:'secret@example.com',code:'12345678'}}))};
 const {a,send,log}=app(service);send.mockRejectedValue(new Error('12345678 secret@example.com'));
 for(let i=0;i<5;i++)expect((await request(a).post('/email-code/request').send({email:'a@b.com'})).status).toBe(200);
 expect((await request(a).post('/email-code/request').send({email:'a@b.com'})).status).toBe(429);
 expect(JSON.stringify(log.error.mock.calls)).not.toMatch(/12345678|secret@example.com/);
});
