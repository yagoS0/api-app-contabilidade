jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
import { podeVerTarefa, criarTarefaUnificada, acaoTarefaUnificada, listarTarefasUnificadas } from '../TarefasUnificadasService.js';
import { normalizarTarefaCalendario } from '../../../../../../packages/shared/src/tarefasCalendario.js';
const task = {id:'t',userId:'u',estados:{},versoes:[],...normalizarTarefaCalendario({titulo:'Apuração',empresasIds:['a','b'],config:{dataInicio:'2026-01-15'}})};
test('visibility includes every historical company and private tasks stay private',()=>{
  expect(podeVerTarefa(task,'u',['a'])).toBe(false);
  expect(podeVerTarefa(task,'other',['a','b'])).toBe(true);
  expect(podeVerTarefa({...task,empresasIds:[]},'other',[])).toBe(false);
  expect(podeVerTarefa({...task,versoes:[{dados:{empresasIds:['secret']}}]},'u',['a','b'])).toBe(false);
});
test('creation rejects cross-portfolio companies without writing',async()=>{
  const db={tarefaCalendario:{create:jest.fn()}};
  await expect(criarTarefaUnificada({userId:'u',portalIds:['a'],dados:task},db)).rejects.toMatchObject({status:404});
  expect(db.tarefaCalendario.create).not.toHaveBeenCalled();
});
test('creation supports all 150 companies with stable checklist identities',async()=>{
  const ids=Array.from({length:150},(_,i)=>`c${i}`), db={tarefaCalendario:{create:jest.fn(({data})=>data)}};
  const out=await criarTarefaUnificada({userId:'u',portalIds:ids,dados:{...task,empresasIds:ids,subtarefas:[{titulo:'MIT'}]}},db);
  expect(out.empresasIds).toHaveLength(150); expect(out.subtarefas[0].id).toBeTruthy();
});
test('action takes advisory lock before read and retains simultaneous company progress',async()=>{
  const calls=[]; let current=task;
  const tx={$queryRaw:jest.fn(()=>calls.push('lock')),tarefaCalendario:{findFirst:jest.fn(()=>{calls.push('read');return current;}),update:jest.fn(({data})=>{current={...current,...data};return current;})}};
  const db={$transaction:fn=>fn(tx)};
  await acaoTarefaUnificada({userId:'u',portalIds:['a','b'],id:'t',dados:{acao:'CONCLUIR',cicloChave:'2026-01-15',companyId:'a'}},db);
  await acaoTarefaUnificada({userId:'u',portalIds:['a','b'],id:'t',dados:{acao:'CONCLUIR',cicloChave:'2026-01-15',companyId:'b'}},db);
  expect(calls).toEqual(['lock','read','lock','read']);
  expect(Object.keys(current.estados['2026-01-15'].empresas)).toEqual(['a','b']);
});
test('editing cannot insert unauthorized company and list cannot reveal names or histories',async()=>{
  const tx={$queryRaw:jest.fn(),tarefaCalendario:{findFirst:jest.fn(()=>task),update:jest.fn()}};
  await expect(acaoTarefaUnificada({userId:'u',portalIds:['a','b'],id:'t',dados:{acao:'EDITAR',cicloChave:'2026-01-15',alteracoes:{empresasIds:['secret']}}},{$transaction:fn=>fn(tx)})).rejects.toMatchObject({status:404});
  expect(tx.tarefaCalendario.update).not.toHaveBeenCalled();
  const db={tarefaCalendario:{findMany:jest.fn(()=>[task])},portalClient:{findMany:jest.fn(()=>[{id:'a',razao:'A'}])}};
  expect(await listarTarefasUnificadas({userId:'u',portalIds:['a'],inicio:'2026-01-01',fim:'2026-01-31'},db)).toEqual({tarefas:[],itens:[]});
});

const intencao='00000000-0000-4000-8000-000000000001';
function bancoDuplicacao() {
 const rows=new Map([[task.id,structuredClone(task)]]);
 const tx={$queryRaw:jest.fn(),tarefaCalendario:{findFirst:jest.fn(({where})=>rows.get(where.id)),findUnique:jest.fn(({where})=>rows.get(where.id)),create:jest.fn(({data})=>{rows.set(data.id,data);return data;})}};
 return {rows,tx,db:{$transaction:fn=>fn(tx)}};
}
test('duplicação é avulsa pendente, com IDs novos e idempotência por intenção',async()=>{
 const {rows,tx,db}=bancoDuplicacao();
 rows.get('t').subtarefas=[{id:'mit',titulo:'MIT'}];
 rows.get('t').estados={'2026-01-15':{empresas:{a:{concluidaEm:'2026-01-15'},b:{concluidaEm:'2026-01-15'}}}};
 const input={userId:'u',portalIds:['a','b'],id:'t',dados:{acao:'DUPLICAR',cicloChave:'2026-01-15',intencaoId:intencao}};
 const first=await acaoTarefaUnificada(input,db),second=await acaoTarefaUnificada(input,db);
 expect(second.id).toBe(first.id);expect(tx.tarefaCalendario.create).toHaveBeenCalledTimes(1);
 expect(first).toMatchObject({titulo:'Apuração (cópia)',empresasIds:['a','b'],estados:{},versoes:[],config:{recorrencia:'AVULSA'}});
 expect(first.subtarefas[0].id).not.toBe('mit');expect(first.subtarefas[0].concluida).toBeUndefined();
 expect(rows.get('t').estados['2026-01-15'].empresas.a.concluidaEm).toBeTruthy();
 first.excluidaEm=new Date();await expect(acaoTarefaUnificada(input,db)).rejects.toMatchObject({status:409});
 expect(tx.tarefaCalendario.create).toHaveBeenCalledTimes(1);
});
test('duplicação recusa tentativa sem identidade, ocorrência inválida e escopo alheio',async()=>{
 const {db,tx}=bancoDuplicacao();
 const input={userId:'u',portalIds:['a','b'],id:'t',dados:{acao:'DUPLICAR',cicloChave:'2026-01-15',intencaoId:intencao}};
 await expect(acaoTarefaUnificada({...input,dados:{...input.dados,intencaoId:undefined}},db)).rejects.toMatchObject({status:400});
 await expect(acaoTarefaUnificada({...input,dados:{...input.dados,cicloChave:'2026-02-15'}},db)).rejects.toMatchObject({status:404});
 await expect(acaoTarefaUnificada({...input,portalIds:['a']},db)).rejects.toMatchObject({status:404});
 expect(tx.tarefaCalendario.create).not.toHaveBeenCalled();
});
test('recuperar cópia revalida proprietário e acesso atuais mesmo com intenção conhecida',async()=>{
 const {rows,db}=bancoDuplicacao();
 const input={userId:'u',portalIds:['a','b'],id:'t',dados:{acao:'DUPLICAR',cicloChave:'2026-01-15',intencaoId:intencao}};
 const copia=await acaoTarefaUnificada(input,db);
 rows.get(copia.id).empresasIds.push('secret');
 await expect(acaoTarefaUnificada(input,db)).rejects.toMatchObject({status:404});
 rows.get(copia.id).empresasIds=['a','b'];rows.get(copia.id).userId='outro';
 await expect(acaoTarefaUnificada(input,db)).rejects.toMatchObject({status:404});
});
