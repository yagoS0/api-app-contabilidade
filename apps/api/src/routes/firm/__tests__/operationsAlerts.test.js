jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{companyFirmAccess:{findMany:jest.fn()},portalClient:{findMany:jest.fn()}}}));
jest.mock('../../../application/operacoes/OperationsService.js',()=>({lerOperacao:jest.fn(),salvarOperacao:jest.fn(),validarCompetencia:jest.fn()}));
jest.mock('../../../application/operacoes/OperationsExecution.js',()=>({executarOperacao:jest.fn()}));
jest.mock('../../../application/tasks/ManualTaskService.js',()=>({backgroundRoute:(_kind,run)=>run}));
import express from 'express';
import request from 'supertest';
import {prisma} from '../../../infrastructure/db/prisma.js';
import {createOperationsRouter} from '../operacoes.js';
test('avisos paginados mantêm total e escopo autorizado; offset inválido recusa',async()=>{
 prisma.companyFirmAccess.findMany.mockResolvedValue([{companyId:'a'}]);
 const db={pendenciaPosFechamento:{findMany:jest.fn(async()=>[{id:'p',portalClientId:'a'}]),count:jest.fn(async()=>201)}};
 const app=express();app.use((req,res,next)=>{req.auth={user:{id:'u',role:'staff'}};next();});app.use('/firm',createOperationsRouter({prisma:db,requireFirmCompanyAccess:()=>((_req,_res,next)=>next())}));
 const result=await request(app).get('/firm/operacoes/avisos?offset=200&companyId=outra');expect(result.status).toBe(200);expect(result.body).toMatchObject({total:201,offset:200,items:[{id:'p'}]});
 expect(db.pendenciaPosFechamento.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{portalClientId:{in:['a']},resolvida:false},skip:200,take:200}));
 await request(app).get('/firm/operacoes/avisos?offset=-1').expect(422);expect(db.pendenciaPosFechamento.findMany).toHaveBeenCalledTimes(1);
});
