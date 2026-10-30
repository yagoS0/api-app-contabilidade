jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{user:{findUnique:jest.fn(async({where})=>({id:where.id,status:'active',accountType:'FIRM',role:'contador'}))},solicitacaoTarefa:{findMany:jest.fn(async()=>[]),findUnique:jest.fn(async()=>null)},tarefaCalendario:{findMany:jest.fn(),create:jest.fn(),findFirst:jest.fn(),update:jest.fn()},portalClient:{findMany:jest.fn()},$transaction:jest.fn(),$queryRaw:jest.fn()}}));
jest.mock('../empresasVisiveis.js',()=>({empresasVisiveis:jest.fn(async()=>['a','b'])}));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createTarefasUnificadasRouter } from '../tarefasUnificadas.js';
import { normalizarTarefaCalendario } from '../../../../../../packages/shared/src/tarefasCalendario.js';
const base={titulo:'Apuração',empresasIds:['a','b'],subtarefas:[{id:'mit',titulo:'MIT'}],config:{dataInicio:'2026-01-15',recorrencia:'MENSAL',diaVencimento:31}};
function app(auth=true){const a=express();a.use(express.json());a.use((req,res,next)=>{if(auth)req.auth={user:{id:'u'}};next();});a.use(createTarefasUnificadasRouter());return a;}
beforeEach(()=>{jest.clearAllMocks();prisma.$transaction.mockImplementation(fn=>fn(prisma));prisma.portalClient.findMany.mockResolvedValue([{id:'a',razao:'Alfa'},{id:'b',razao:'Beta'}]);prisma.tarefaCalendario.findMany.mockResolvedValue([]);});
test('all new routes require session before reading or writing',async()=>{
  expect((await request(app(false)).get('/agenda/unificada/t')).status).toBe(401);
  expect((await request(app(false)).get('/agenda/unificada?inicio=2026-01-01&fim=2026-01-31')).status).toBe(401);
  expect((await request(app(false)).post('/agenda/unificada').send(base)).status).toBe(401);
  expect((await request(app(false)).post('/agenda/unificada/t/acao').send({acao:'CONCLUIR'})).status).toBe(401);
  expect(prisma.tarefaCalendario.findMany).not.toHaveBeenCalled();expect(prisma.tarefaCalendario.create).not.toHaveBeenCalled();
});

test('GET by identity works outside interval and distinguishes cancelled cycle without writes', async () => {
  prisma.tarefaCalendario.findUnique = jest.fn().mockResolvedValue({ ...normalizarTarefaCalendario(base), id: 't', userId: 'u', versoes: [], estados: { '2026-01': { canceladaEm: '2026-01-16' } } });
  const response = await request(app()).get('/agenda/unificada/t?cicloChave=2026-01');
  expect(response.status).toBe(200);
  expect(response.body.tarefa).toMatchObject({ id: 't', ciclo: { chave: '2026-01', estado: 'CANCELADA' } });
  expect(prisma.tarefaCalendario.update).not.toHaveBeenCalled();
  expect(prisma.tarefaCalendario.create).not.toHaveBeenCalled();
  expect((await request(app()).get('/agenda/unificada/t?inicio=2026-01-01')).status).toBe(400);
});
test('invalid date and out-of-portfolio company return validated public errors',async()=>{
  expect((await request(app()).get('/agenda/unificada?inicio=bad&fim=2026-01-31')).status).toBe(400);
  expect((await request(app()).get('/agenda/unificada?inicio=2026-01-01&fim=2026-01-31&companyId=secret')).status).toBe(404);
  expect((await request(app()).post('/agenda/unificada').send({...base,empresasIds:['secret']})).status).toBe(404);
  expect(prisma.tarefaCalendario.create).not.toHaveBeenCalled();
});
test('create/list/action use actual service contracts and projection identity',async()=>{
  let row;
  prisma.tarefaCalendario.create.mockImplementation(({data})=>{row={...data,id:'t',estados:{},versoes:[]};return row;});
  const created=await request(app()).post('/agenda/unificada').send(base);
  expect(created.body).toMatchObject({ok:true,tarefa:{id:'t',titulo:'Apuração'}});
  prisma.tarefaCalendario.findMany.mockImplementation(()=>[row]);
  prisma.tarefaCalendario.findFirst.mockImplementation(()=>row);
  prisma.tarefaCalendario.update.mockImplementation(({data})=>{row={...row,...data};return row;});
  const listed=await request(app()).get('/agenda/unificada?inicio=2026-01-30&fim=2026-01-31');
  expect(listed.body.itens[0]).toMatchObject({id:'t:2026-01',diasAlerta:['2026-01-30','2026-01-31'],empresas:[{companyId:'a',nome:'Alfa'},{companyId:'b',nome:'Beta'}]});
  expect((await request(app()).post('/agenda/unificada/t/acao').send({acao:'CONCLUIR',cicloChave:'2026-01'})).body.ok).toBe(true);
  expect((await request(app()).get('/agenda/unificada?inicio=2026-01-30&fim=2026-01-31')).body.itens).toEqual([]);
});
test('unauthorized existing task and invalid company checklist cannot write',async()=>{
  prisma.tarefaCalendario.findFirst.mockResolvedValue({...base,id:'t',userId:'u',estados:{},empresasIds:['secret']});
  expect((await request(app()).post('/agenda/unificada/t/acao').send({acao:'CONCLUIR',cicloChave:'2026-01'})).status).toBe(404);
  prisma.tarefaCalendario.findFirst.mockResolvedValue({...base,id:'t',userId:'u',estados:{}});
  expect((await request(app()).post('/agenda/unificada/t/acao').send({acao:'SUBTAREFA',cicloChave:'2026-01',companyId:'secret',subtarefaId:'mit',concluida:true})).status).toBe(400);
  expect(prisma.tarefaCalendario.update).not.toHaveBeenCalled();
});

test('recusa definitiva da cópia excluída tem código HTTP estável sem escrita',async()=>{
 prisma.tarefaCalendario.findFirst.mockResolvedValue({...base,id:'t',userId:'u',estados:{},versoes:[]});
 prisma.tarefaCalendario.findUnique=jest.fn().mockResolvedValue({...base,id:'copia',userId:'u',estados:{'2026-01-15':{canceladaEm:'2026-01-16'}},versoes:[]});
 const response=await request(app()).post('/agenda/unificada/t/acao').send({acao:'DUPLICAR',cicloChave:'2026-01',intencaoId:'00000000-0000-4000-8000-000000000001'});
 expect(response.status).toBe(409);expect(response.body).toMatchObject({ok:false,error:'CALENDAR_COPY_DELETED'});
 expect(prisma.tarefaCalendario.create).not.toHaveBeenCalled();expect(prisma.tarefaCalendario.update).not.toHaveBeenCalled();
});
