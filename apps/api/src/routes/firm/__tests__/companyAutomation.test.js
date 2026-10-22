jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
jest.mock('../../../application/fiscal/serpro/CompanyAutomationService.js', () => ({ lerAutomacaoEmpresa: jest.fn(), salvarAutomacaoEmpresa: jest.fn() }));
jest.mock('../../../application/operacoes/OperationsRoutines.js', () => ({ listarRotinasOperacoes: jest.fn() }));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { requireFirmCompanyAccess } from '../../../middlewares/requireFirmCompanyAccess.js';
import { lerAutomacaoEmpresa, salvarAutomacaoEmpresa } from '../../../application/fiscal/serpro/CompanyAutomationService.js';
import { createCompanyAutomationRouter } from '../companyAutomation.js';
const mount = (user={id:'user',role:'contador'}) => {
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.auth={user};next();});
 app.use(createCompanyAutomationRouter({prisma,requireFirmCompanyAccess}));return app;
};
beforeEach(()=>{jest.clearAllMocks();prisma.companyFirmAccess.findUnique.mockResolvedValue({role:'ACCOUNTANT',status:'ACTIVE',scopes:[]});lerAutomacaoEmpresa.mockResolvedValue({lembretes:{enabled:false}});salvarAutomacaoEmpresa.mockResolvedValue({lembretes:{enabled:true}});});

test('GET é somente leitura; PUT usa empresa da rota e ator autenticado', async()=>{
 const app=mount();const body={expectedRevision:'revision',requestId:'request-123',companyId:'outra',userId:'outro',lembretes:{enabled:true}};
 const read=await request(app).get('/companies/a/automacao');expect(read.status).toBe(200);expect(read.headers['cache-control']).toBe('no-store');expect(salvarAutomacaoEmpresa).not.toHaveBeenCalled();
 expect((await request(app).put('/companies/a/automacao').send(body)).status).toBe(200);
 expect(salvarAutomacaoEmpresa).toHaveBeenCalledWith(prisma,'a','user',body,{isAdmin:false});
 expect(prisma.companyFirmAccess.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({where:{companyId_userId:{companyId:'a',userId:'user'}}}));
});

test.each([null,{role:'STAFF',status:'ACTIVE'},{role:'ACCOUNTANT',status:'REMOVED'}])('PUT rejeita acesso insuficiente %j',async access=>{
 prisma.companyFirmAccess.findUnique.mockResolvedValue(access);
 expect((await request(mount()).put('/companies/a/automacao').send({lembretes:{enabled:true}})).status).toBe(403);
 expect(salvarAutomacaoEmpresa).not.toHaveBeenCalled();
});

test('sem autenticação não lê nem salva; vínculo de outra empresa não autoriza',async()=>{
 expect((await request(mount(null)).get('/companies/a/automacao')).status).toBe(401);
 prisma.companyFirmAccess.findUnique.mockImplementation(async({where})=>where.companyId_userId.companyId==='a'?{role:'ACCOUNTANT',status:'ACTIVE'}:null);
 expect((await request(mount()).put('/companies/b/automacao').send({companyId:'a',lembretes:{enabled:true}})).status).toBe(403);
 expect(salvarAutomacaoEmpresa).not.toHaveBeenCalled();expect(lerAutomacaoEmpresa).not.toHaveBeenCalled();
});

test.each(['P2034','P2002'])('conflito transacional %s retorna 409 sem sucesso',async code=>{
 salvarAutomacaoEmpresa.mockRejectedValue(Object.assign(new Error('conflito'),{code}));
 const result=await request(mount()).put('/companies/a/automacao').send({lembretes:{enabled:true}});
 expect(result.status).toBe(409);expect(result.body).toMatchObject({ok:false,error:'AUTOMATION_CHANGED'});
});
