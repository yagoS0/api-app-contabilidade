import express from 'express';
import request from 'supertest';
import { createFluxoCarteiraRouter } from '../fluxoCarteira.js';
import { prisma } from '../../../infrastructure/db/prisma.js';
jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{companyFirmAccess:{findUnique:jest.fn()}}}));
jest.mock('../../../application/company/FluxoCarteiraService.js',()=>({lerFluxoEmpresa:jest.fn(),salvarFluxoTarefa:jest.fn()}));
function app(role='staff') {
  const server=express();server.use(express.json());server.use((req,res,next)=>{req.auth={user:{id:'u',role}};next();});
  const ler=jest.fn().mockResolvedValue({fluxo:{},lancamentos:[]}),salvar=jest.fn().mockResolvedValue({salvo:true});
  server.use('/companies/:companyId',createFluxoCarteiraRouter({ler,salvar}));return {server,ler,salvar};
}
beforeEach(()=>jest.clearAllMocks());
test('empresa fora da carteira não permite leitura',async()=>{
  prisma.companyFirmAccess.findUnique.mockResolvedValue(null);const {server,ler}=app();
  expect((await request(server).get('/companies/outra/fluxo-carteira?competencia=2026-09')).status).toBe(403);expect(ler).not.toHaveBeenCalled();
});
test('STAFF pode ler, mas não confirmar importação',async()=>{
  prisma.companyFirmAccess.findUnique.mockResolvedValue({role:'STAFF',status:'ACTIVE',scopes:[]});const {server,salvar}=app();
  expect((await request(server).get('/companies/a/fluxo-carteira?competencia=2026-09')).status).toBe(200);
  expect((await request(server).post('/companies/a/fluxo-carteira/importar').send({competencia:'2026-09'})).status).toBe(403);expect(salvar).not.toHaveBeenCalled();
});
test('contador autorizado usa ator autenticado e escopo da URL',async()=>{
  prisma.companyFirmAccess.findUnique.mockResolvedValue({role:'ACCOUNTANT',status:'ACTIVE',scopes:[]});const {server,salvar}=app();
  const body={competencia:'2026-09',userId:'falso'};
  expect((await request(server).post('/companies/a/fluxo-carteira/apurar').send(body)).status).toBe(200);
  expect(salvar).toHaveBeenCalledWith('a','2026-09','apurar',body,'u');
});
