jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{$transaction:jest.fn(),$queryRaw:jest.fn(),obrigacao:{findMany:jest.fn(),updateMany:jest.fn()},regraObrigacao:{findUnique:jest.fn(),update:jest.fn()},ocorrenciaObrigacao:{findMany:jest.fn(),update:jest.fn(),updateMany:jest.fn()},agendaOcultacao:{upsert:jest.fn()}}}));
jest.mock('../empresasVisiveis.js',()=>({empresasVisiveis:jest.fn(async()=>['permitida'])}));
jest.mock('../../../application/calendario/CalendarioFiscalService.js',()=>({limitesDoMes:()=>true,montarCalendarioDoMes:jest.fn(async()=>({dias:[]}))}));
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
