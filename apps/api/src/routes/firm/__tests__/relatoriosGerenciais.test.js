import express from 'express';
import request from 'supertest';
jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{$transaction:jest.fn(),companyFirmAccess:{findUnique:jest.fn()},classificacaoGerencial:{create:jest.fn(),updateMany:jest.fn(),findUnique:jest.fn()}}}));
jest.mock('../../../application/planejamento/AnaliseEmpresaService.js',()=>({obterAnaliseEmpresa:jest.fn(async()=>({ok:true,atual:{indicadores:{resultado:1000}}}))}));
jest.mock('../../../application/planejamento/ClientesAnaliseService.js',()=>({obterClientesAnalise:jest.fn(async()=>({ok:true}))}));
jest.mock('../../../application/planejamento/DadosPlanejamentoService.js',()=>({montarDadosPlanejamento:jest.fn(async()=>({}))}));
jest.mock('../../../application/planejamento/SimulacaoPlanejamentoService.js',()=>({salvarSimulacao:jest.fn(),listarSimulacoes:jest.fn(),gerarDocumentoDaSimulacao:jest.fn(),SimulacaoPlanejamentoError:class extends Error{}}));
jest.mock('../../../application/accounting/AliquotaPorLancamentosService.js',()=>({carregarPlano:jest.fn(async()=>new Map([['1',{codigoCompleto:'41101001',analitica:true}]]))}));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { obterAnaliseEmpresa } from '../../../application/planejamento/AnaliseEmpresaService.js';
import { obterClientesAnalise } from '../../../application/planejamento/ClientesAnaliseService.js';
import { createPlanejamentoRouter } from '../planejamento.js';
function app(){const a=express();a.use(express.json());a.use((req,res,next)=>{req.auth={user:{id:'contador',role:'user'}};next();});a.use('/companies/:companyId',createPlanejamentoRouter());return a;}
beforeEach(()=>{jest.clearAllMocks();prisma.companyFirmAccess.findUnique.mockResolvedValue({status:'ACTIVE',role:'ACCOUNTANT'});});
test('fotografia usa mesmo cliente transacional, isolamento e empresa do path',async()=>{
 const client={baseSociosGerencial:{findMany:jest.fn(async()=>[])},classificacaoGerencial:{findUnique:jest.fn(async()=>null)},portalClient:{findUnique:jest.fn(async()=>({id:'a',razao:'Empresa do banco',cnpj:'123'}))}};
 prisma.$transaction.mockImplementation(async fn=>fn(client));
 const r=await request(app()).get('/companies/a/planejamento/analise/relatorio?de=2026-08&ate=2026-08&portalClientId=outra');
 expect(r.status).toBe(200);expect(r.body.empresa.razao).toBe('Empresa do banco');
 expect(prisma.$transaction.mock.calls[0][1]).toMatchObject({isolationLevel:'RepeatableRead'});
 for(const fn of [obterAnaliseEmpresa,obterClientesAnalise])expect(fn).toHaveBeenCalledWith(expect.objectContaining({client,portalClientId:'a'}));
});
test('sem vínculo não consulta dados nem grava classificação',async()=>{
 prisma.companyFirmAccess.findUnique.mockResolvedValue(null);
 expect((await request(app()).get('/companies/a/planejamento/analise/relatorio?de=2026-08&ate=2026-08')).status).toBe(403);
 expect((await request(app()).put('/companies/a/planejamento/classificacao').send({contas:{},revisao:0})).status).toBe(403);
 expect(prisma.$transaction).not.toHaveBeenCalled();expect(prisma.classificacaoGerencial.create).not.toHaveBeenCalled();
});
test('classificação exige contador e revisão protege edição concorrente',async()=>{
 prisma.companyFirmAccess.findUnique.mockResolvedValueOnce({status:'ACTIVE',role:'STAFF'});
 expect((await request(app()).put('/companies/a/planejamento/classificacao').send({contas:{},revisao:0})).status).toBe(403);
 prisma.classificacaoGerencial.updateMany.mockResolvedValue({count:0});
 const r=await request(app()).put('/companies/a/planejamento/classificacao').send({contas:{'41101001':{comportamento:'FIXO',prolabore:true}},revisao:3,companyId:'outra'});
 expect(r.status).toBe(409);expect(prisma.classificacaoGerencial.updateMany.mock.calls[0][0].where).toEqual({companyId:'a',revisao:3});
});
test('conta inexistente não entra no mapa',async()=>{
 const r=await request(app()).put('/companies/a/planejamento/classificacao').send({contas:{'999':{comportamento:'FIXO',prolabore:false}},revisao:0});expect(r.status).toBe(400);expect(prisma.classificacaoGerencial.create).not.toHaveBeenCalled();
});

test('reabertura bloqueia API e impressão com competências explícitas',async()=>{
 const erro=Object.assign(new Error('Feche a contabilidade: 2026-08.'),{code:'CONTABILIDADE_ABERTA',mesesSemFechamento:['2026-08']});
 obterAnaliseEmpresa.mockRejectedValueOnce(erro);
 let r=await request(app()).get('/companies/a/planejamento/analise?de=2026-08&ate=2026-08');
 expect(r.status).toBe(409);expect(r.body).toMatchObject({error:'CONTABILIDADE_ABERTA',mesesSemFechamento:['2026-08']});
 obterClientesAnalise.mockRejectedValueOnce(erro);
 r=await request(app()).get('/companies/a/planejamento/analise/clientes?de=2026-08&ate=2026-08');expect(r.status).toBe(409);
 prisma.$transaction.mockRejectedValueOnce(erro);
 r=await request(app()).get('/companies/a/planejamento/analise/relatorio?de=2026-08&ate=2026-08');expect(r.status).toBe(409);expect(r.body.mesesSemFechamento).toEqual(['2026-08']);
});
test('detalhamento lê fechamento na mesma transação e recusa mês reaberto',async()=>{
 const client={companyMonthlyCircular:{findMany:jest.fn(async()=>[])},accountingEntry:{findMany:jest.fn()}};
 prisma.$transaction.mockImplementation(async fn=>fn(client));
 const r=await request(app()).get('/companies/a/planejamento/analise/lancamentos?de=2026-08&ate=2026-08&conta=1');
 expect(r.status).toBe(409);expect(client.accountingEntry.findMany).not.toHaveBeenCalled();expect(prisma.$transaction.mock.calls[0][1].isolationLevel).toBe('RepeatableRead');expect(client.companyMonthlyCircular.findMany.mock.calls[0][0].where.portalClientId).toBe('a');
});
