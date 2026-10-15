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
