jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{$transaction:jest.fn(),$queryRaw:jest.fn(),obrigacao:{findMany:jest.fn(),updateMany:jest.fn()},regraObrigacao:{findUnique:jest.fn(),update:jest.fn()},ocorrenciaObrigacao:{findMany:jest.fn(),update:jest.fn(),updateMany:jest.fn()},agendaOcultacao:{upsert:jest.fn()}}}));
jest.mock('../empresasVisiveis.js',()=>({empresasVisiveis:jest.fn(async()=>['permitida'])}));
jest.mock('../../../application/calendario/CalendarioFiscalService.js',()=>({limitesDoMes:()=>true,montarCalendarioDoMes:jest.fn(async()=>({dias:[]}))}));
import { listar } from '../../../application/obrigacoes/ObrigacoesService.js';
import express from 'express';
import request from 'supertest';
import {prisma} from '../../../infrastructure/db/prisma.js';
import {createAgendaRouter} from '../agenda.js';
function app(usuario='u') {const a=express();a.use(express.json());a.use((req,res,next)=>{req.auth={user:usuario?{id:usuario}:null};next();});a.use(createAgendaRouter());return a;}
beforeEach(()=>{jest.clearAllMocks();prisma.$transaction.mockImplementation(fn=>fn(prisma));});
test('agenda exige sessão',async()=>expect((await request(app(null)).get('/agenda/tarefas?inicio=2026-09-01&fim=2026-09-30')).status).toBe(401));
test('lote misturando ocorrência fora da carteira não grava nenhuma',async()=>{
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([{id:'visivel',obrigacaoId:'s'}]);
  const r=await request(app()).post('/agenda/ocorrencias/excluir').send({ids:['visivel','invisivel']});expect(r.status).toBe(404);expect(prisma.ocorrenciaObrigacao.update).not.toHaveBeenCalled();expect(prisma.$queryRaw).not.toHaveBeenCalled();
  expect(prisma.ocorrenciaObrigacao.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({obrigacao:{portalClientId:{in:['permitida']}}})}));
});
test('excluir série não alcança empresas fora da carteira',async()=>{
  prisma.obrigacao.findMany.mockResolvedValue([{id:'s',portalClientId:'fora'}]);prisma.regraObrigacao.findUnique.mockResolvedValue({id:'r',criadoPorId:'u'});
  expect((await request(app()).post('/agenda/series/excluir').send({regraId:'r'})).status).toBe(404);expect(prisma.obrigacao.updateMany).not.toHaveBeenCalled();
});
test('série vazia de outro proprietário não pode ser excluída',async()=>{
  prisma.obrigacao.findMany.mockResolvedValue([]);prisma.regraObrigacao.findUnique.mockResolvedValue({id:'r',criadoPorId:'outro'});
  expect((await request(app()).post('/agenda/series/excluir').send({regraId:'r'})).status).toBe(404);expect(prisma.regraObrigacao.update).not.toHaveBeenCalled();
});
test('exclusão total inativa regra e preserva registros de conclusão',async()=>{
  prisma.obrigacao.findMany.mockResolvedValue([{id:'s',portalClientId:'permitida'}]);prisma.regraObrigacao.findUnique.mockResolvedValue({id:'r',criadoPorId:'u'});
  expect((await request(app()).post('/agenda/series/excluir').send({regraId:'r'})).status).toBe(200);
  expect(prisma.regraObrigacao.update).toHaveBeenCalledWith({where:{id:'r'},data:{ativa:false,aplicarANovas:false}});
  expect(prisma.ocorrenciaObrigacao.updateMany).toHaveBeenCalledWith({where:{obrigacaoId:{in:['s']},canceladaEm:null},data:{canceladaEm:expect.any(Date),canceladaPorId:'u'}});
});
test('edição de período mantém o vencimento fiscal',async()=>{
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([{id:'oc',obrigacaoId:'s',status:'PENDENTE',obrigacao:{tipo:'OBRIGACAO'}}]);
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:['oc'],dados:{titulo:'EFD',dataInicio:'2026-09-10',dataFim:'2026-09-15',horaInicio:'09:00',horaFim:'10:00',prioridade:'ALTA'}});
  expect(r.status).toBe(200);expect(prisma.ocorrenciaObrigacao.update.mock.calls[0][0].data).not.toHaveProperty('dataVencimento');expect(prisma.ocorrenciaObrigacao.update.mock.calls[0][0].data.agendaConfig).toMatchObject({prioridade:'ALTA',horaInicio:'09:00'});
});
test('ocultar guia exige item visível e não altera documento de origem',async()=>{
  const r=await request(app()).post('/agenda/ocultar').send({tipo:'guia',id:'g',mes:'2026-09'});expect(r.status).toBe(404);expect(prisma.agendaOcultacao.upsert).not.toHaveBeenCalled();
});


test('edita agenda de grupo concluído sem reabrir, alterar auditoria ou vencimento fiscal',async()=>{
  const alvos=['PENDENTE','CONCLUIDA'].map((status,i)=>({id:'oc-'+i,obrigacaoId:'s-'+i,status,obrigacao:{tipo:'OBRIGACAO'}}));
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue(alvos);
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:alvos.map(o=>o.id),dados:{titulo:'Revisão EFD',descricao:'Conferir serviços',dataInicio:'2026-09-10',dataFim:'2026-09-16',horaInicio:'09:00',horaFim:'11:00'}});
  expect(r.status).toBe(200);expect(r.body.atualizadas).toBe(2);
  for(const [chamada] of prisma.ocorrenciaObrigacao.update.mock.calls) expect(chamada.data).toEqual({dataInicio:new Date('2026-09-10'),dataFim:new Date('2026-09-16'),janelaPersonalizada:true,agendaConfig:{titulo:'Revisão EFD',descricao:'Conferir serviços',horaInicio:'09:00',horaFim:'11:00',prioridade:''}});
});

test.each([{canceladaEm:new Date()},{foraDaRecorrencia:true}])('edição continua recusando ocorrência indisponível %o',async(indisponivel)=>{
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([{id:'oc',obrigacaoId:'s',status:'CONCLUIDA',obrigacao:{tipo:'OBRIGACAO'},...indisponivel}]);
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:['oc'],dados:{titulo:'EFD',dataInicio:'2026-09-10',dataFim:'2026-09-15'}});
  expect(r.status).toBe(409);expect(prisma.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
});


test('listagem identifica cada empresa pelo CNPJ dentro da carteira autorizada',async()=>{
  prisma.obrigacao.findMany.mockResolvedValue([{id:'s',portalClientId:'permitida',nome:'EFD',portalClient:{razao:'Consultoria Alfa',cnpj:'11222333000181'},ocorrencias:[]}]);
  const out=await listar({portalIds:['permitida']});
  expect(out.obrigacoes[0]).toMatchObject({companyId:'permitida',empresa:'Consultoria Alfa',cnpj:'11222333000181'});
  expect(prisma.obrigacao.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({portalClientId:{in:['permitida']}}),include:expect.objectContaining({portalClient:{select:{id:true,razao:true,cnpj:true}}})}));
});

const ocorrenciaEditavel = (id='oc', extra={}) => ({id,obrigacaoId:'serie-'+id,dataInicio:new Date('2026-09-10'),dataFim:new Date('2026-09-10'),status:'CONCLUIDA',dataVencimento:new Date('2026-09-21'),obrigacao:{tipo:'OBRIGACAO',nome:'EFD',descricao:'Da série',agendaConfig:{horaInicio:'09:00',horaFim:'10:00',prioridade:'BAIXA'}},agendaConfig:{titulo:'EFD '+id,descricao:'Da empresa '+id,prioridade:'ALTA'},...extra});

test('gesto parcial preserva campos individuais e usa a leitura após adquirir os locks',async()=>{
  const antes=['a','b'].map(id=>ocorrenciaEditavel(id));
  const atuais=antes.map(oc=>({...oc,agendaConfig:{...oc.agendaConfig,descricao:'Atualizada '+oc.id,prioridade:'URGENTE',vencimentoFiscal:'2026-09-21'}}));
  let bloqueios=0;prisma.$queryRaw.mockImplementation(async()=>{bloqueios++;});
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValueOnce(antes).mockImplementationOnce(async()=>{expect(bloqueios).toBe(2);return atuais;});
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:['a','b'],dados:{dataInicio:'2026-09-11',dataFim:'2026-09-11',horaInicio:'11:00',horaFim:'12:00'}});
  expect(r.status).toBe(200);
  for(const [chamada] of prisma.ocorrenciaObrigacao.update.mock.calls) {
    expect(chamada.data.agendaConfig).toEqual({titulo:'EFD '+chamada.where.id,descricao:'Atualizada '+chamada.where.id,prioridade:'URGENTE',horaInicio:'11:00',horaFim:'12:00',vencimentoFiscal:'2026-09-21'});
    for(const campo of ['status','concluidaEm','concluidaPorId','dataVencimento']) expect(chamada.data).not.toHaveProperty(campo);
  }
});

test('patch pode limpar horários e descrição explicitamente sem limpar prioridade',async()=>{
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrenciaEditavel()]);
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:['oc'],dados:{horaInicio:null,horaFim:null,descricao:null}});
  expect(r.status).toBe(200);
  expect(prisma.ocorrenciaObrigacao.update).toHaveBeenCalledWith({where:{id:'oc'},data:{dataInicio:new Date('2026-09-10'),dataFim:new Date('2026-09-10'),janelaPersonalizada:true,agendaConfig:{titulo:'EFD oc',descricao:'',prioridade:'ALTA',horaInicio:null,horaFim:null}}});
});

test('valida todas as janelas do grupo antes de gravar a primeira',async()=>{
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrenciaEditavel('a'),ocorrenciaEditavel('b',{dataInicio:new Date('2026-09-15'),dataFim:new Date('2026-09-15')})]);
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:['a','b'],dados:{dataFim:'2026-09-12'}});
  expect(r.status).toBe(400);expect(prisma.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
});

test('patch parcial não altera ocorrência fora da carteira',async()=>{
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrenciaEditavel('visivel')]);
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:['visivel','invisivel'],dados:{horaInicio:'10:00',horaFim:'11:00'}});
  expect(r.status).toBe(404);expect(prisma.ocorrenciaObrigacao.update).not.toHaveBeenCalled();expect(prisma.$queryRaw).not.toHaveBeenCalled();
});

test('ocorrência cancelada durante a espera pelo lock não é editada',async()=>{
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValueOnce([ocorrenciaEditavel()]).mockResolvedValueOnce([ocorrenciaEditavel('oc',{canceladaEm:new Date()})]);
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:['oc'],dados:{horaInicio:'10:00',horaFim:'11:00'}});
  expect(r.status).toBe(409);expect(prisma.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
});

test('tarefa vinculada à empresa conserva compatibilidade de vencimento e edição completa',async()=>{
  const oc=ocorrenciaEditavel();oc.obrigacao.tipo='TAREFA';prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([oc]);
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:['oc'],dados:{titulo:'Novo título',descricao:'',dataInicio:'2026-09-12',dataFim:'2026-09-13',horaInicio:'14:00',horaFim:'15:00',prioridade:''}});
  expect(r.status).toBe(200);expect(prisma.ocorrenciaObrigacao.update.mock.calls[0][0].data).toMatchObject({dataVencimento:new Date('2026-09-13'),agendaConfig:{titulo:'Novo título',descricao:'',prioridade:'',horaInicio:'14:00',horaFim:'15:00'}});
});

test('obrigação legada sem janela aceita só horários usando a data do vencimento',async()=>{
  prisma.ocorrenciaObrigacao.findMany.mockResolvedValue([ocorrenciaEditavel('oc',{dataInicio:null,dataFim:null,agendaConfig:null})]);
  const r=await request(app()).post('/agenda/ocorrencias/editar').send({ids:['oc'],dados:{horaInicio:'09:00',horaFim:'10:00'}});
  expect(r.status).toBe(200);
  const {data}=prisma.ocorrenciaObrigacao.update.mock.calls[0][0];
  expect(data).toMatchObject({dataInicio:new Date('2026-09-21'),dataFim:new Date('2026-09-21'),agendaConfig:{titulo:'EFD',descricao:'Da série',horaInicio:'09:00',horaFim:'10:00'}});
  expect(data).not.toHaveProperty('dataVencimento');
});
