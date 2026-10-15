import { normalizarTarefaCalendario, expandirTarefaCalendario, aplicarAcaoTarefaCalendario } from '../../../../../../packages/shared/src/tarefasCalendario.js';
const tarefa = (config = {}, extra = {}) => ({ id:'t',userId:'u',estados:{},versoes:[], ...normalizarTarefaCalendario({titulo:'Apuração',empresasIds:['a','b'],subtarefas:[{id:'mit',titulo:'MIT'},{id:'efd',titulo:'EFD'}],config:{dataInicio:'2026-01-15',recorrencia:'MENSAL',diaVencimento:31,...config}}),...extra });
const list = (t,inicio='2026-01-01',fim='2026-03-31')=>expandirTarefaCalendario(t,inicio,fim);
const act = (t,data)=>({...t,...aplicarAcaoTarefaCalendario(t,{cicloChave:'2026-01',...data},'2026-01-10T10:00:00Z')});
test('nominal 31 clamps February including leap year without losing March 31',()=>{
  expect(list(tarefa()).map(o=>o.dataVencimento)).toEqual(['2026-01-31','2026-02-28','2026-03-31']);
  expect(list(tarefa({dataInicio:'2028-01-15'}),'2028-02-01','2028-02-29')[0].dataVencimento).toBe('2028-02-29');
});
test('range with fixed time is one identity and one completion across all dates',()=>{
  let t=tarefa({dataInicio:'2026-01-15',dataFim:'2026-01-18',horarioModo:'FIXO',horaInicio:'10:00'});
  expect(list(t,'2026-01-15','2026-01-18')).toHaveLength(1);
  t=act(t,{acao:'CONCLUIR'});
  expect(list(t,'2026-01-17','2026-01-17')[0]).toMatchObject({resolvido:true,diasAlerta:[],horaInicio:'10:00'});
  expect(list(t).find(i=>i.cicloChave==='2026-02').resolvido).toBe(false);
});
test('due projections are included even outside scheduled interval and disappear on completion',()=>{
  let t=tarefa();
  const item=list(t,'2026-01-30','2026-01-31')[0];
  expect(item.diasAlerta).toEqual(['2026-01-30','2026-01-31']);
  expect(item.id).toBe(list(t,'2026-01-15','2026-01-15')[0].id);
  t=act(t,{acao:'CONCLUIR'});
  expect(list(t,'2026-01-30','2026-01-31')).toEqual([]);
});
test('per-company checklist cannot complete another company or another month',()=>{
  let t=tarefa();
  for(const subtarefaId of ['mit','efd']) t=act(t,{acao:'SUBTAREFA',companyId:'a',subtarefaId,concluida:true});
  expect(list(t)[0].empresas.map(e=>e.concluida)).toEqual([true,false]);
  expect(list(t)[0].resolvido).toBe(false);
  t=act(t,{acao:'CONCLUIR',companyId:'b'});
  expect(list(t)[0].resolvido).toBe(true);
  t=act(t,{acao:'SUBTAREFA',companyId:'a',subtarefaId:'mit',concluida:false});
  expect(list(t)[0].resolvido).toBe(false);
  expect(list(t)[1].empresas.every(e=>!e.concluida)).toBe(true);
});
test('date and count ending are enforced including alerts after last start date',()=>{
  expect(list(tarefa({repetirQuantidade:2})).map(i=>i.cicloChave)).toEqual(['2026-01','2026-02']);
  expect(list(tarefa({repetirAte:'2026-02-15'}),'2026-02-28','2026-03-31').map(i=>i.cicloChave)).toEqual(['2026-02']);
});
test('individual edit moves occurrence to another year preserving identity and other cycles',()=>{
  const t=act(tarefa(),{acao:'EDITAR',alteracoes:{titulo:'Alterada',config:{dataInicio:'2027-05-10',dataFim:'2027-05-12'}}});
  expect(list(t,'2027-05-10','2027-05-12').find(i=>i.cicloChave==='2026-01')).toMatchObject({titulo:'Alterada',dataFim:'2027-05-12'});
  expect(list(t)[0].cicloChave).toBe('2026-02');
});
test('series editing preserves earlier cycles, changes future ones and guards existing history',()=>{
  let t=act(tarefa(),{acao:'CONCLUIR'});
  t=act(t,{acao:'EDITAR_SERIE',cicloChave:'2026-02',alteracoes:{titulo:'Nova',config:{dataInicio:'2026-02-18',dataFim:'2026-02-18'}}});
  expect(list(t).map(i=>[i.titulo,i.dataInicio])).toEqual([['Apuração','2026-01-15'],['Nova','2026-02-18'],['Nova','2026-03-18']]);
  expect(list(act(t,{acao:'EDITAR_SERIE',alteracoes:{titulo:'X'}}))[0]).toMatchObject({titulo:'Apuração',resolvido:true});
});
test('validation accepts over 100 companies and rejects malformed schedules and checklist ids',()=>{
  expect(tarefa({}, {empresasIds:Array.from({length:150},(_,i)=>String(i))}).empresasIds).toHaveLength(150);
  expect(()=>tarefa({horarioModo:'ATE',horaLimite:'25:00'})).toThrow();
  expect(tarefa({horarioModo:'ATE',horaLimite:'18:00'}).config).toMatchObject({horaInicio:null,horaLimite:'18:00'});
  expect(()=>tarefa({diaVencimento:32})).toThrow();
  expect(()=>act(tarefa(),{acao:'SUBTAREFA',companyId:'outside',subtarefaId:'mit',concluida:true})).toThrow();
});
test('first-day due alert is visible in the previous month and explicit due is independent of repeat end',()=>{
  expect(list(tarefa({diaVencimento:1}),'2026-01-31','2026-01-31')[0]).toMatchObject({cicloChave:'2026-02',diasAlerta:['2026-01-31','2026-02-01']});
  const t=tarefa({recorrencia:'AVULSA',dataVencimento:'2026-04-20'});
  expect(list(t,'2026-04-19','2026-04-20')[0]).toMatchObject({cicloChave:'2026-01-15',dataVencimento:'2026-04-20'});
});
test('removing and renaming subtasks keeps stable progress and newly added checks remain pending',()=>{
  let t=act(tarefa(),{acao:'SUBTAREFA',companyId:'a',subtarefaId:'mit',concluida:true});
  t=act(t,{acao:'EDITAR',alteracoes:{subtarefas:[{id:'mit',titulo:'MIT revisado'},{id:'new',titulo:'Novo'}]}});
  expect(list(t)[0].empresas[0].subtarefas).toEqual([{id:'mit',titulo:'MIT revisado',concluida:true},{id:'new',titulo:'Novo',concluida:false}]);
});
test('personal checklist supports checking, aggregate completion and reopening',()=>{
  let t=tarefa({}, {empresasIds:[]});
  t=act(t,{acao:'SUBTAREFA',subtarefaId:'mit',concluida:true});
  expect(list(t)[0].subtarefas.map(s=>s.concluida)).toEqual([true,false]);
  t=act(t,{acao:'SUBTAREFA',subtarefaId:'efd',concluida:true});
  expect(list(t)[0]).toMatchObject({resolvido:true,diasAlerta:[]});
  t=act(t,{acao:'SUBTAREFA',subtarefaId:'mit',concluida:false});
  expect(list(t)[0].resolvido).toBe(false);
  t=act(t,{acao:'CONCLUIR'});
  expect(list(t)[0].subtarefas.every(s=>s.concluida)).toBe(true);
  t=act(t,{acao:'REABRIR'});
  expect(list(t)[0].subtarefas.every(s=>!s.concluida)).toBe(true);
});
test('series frequency change preserves future completed and partially checked occurrences',()=>{
  let t=act(tarefa(),{acao:'CONCLUIR',cicloChave:'2026-03'});
  t=act(t,{acao:'SUBTAREFA',cicloChave:'2026-02',companyId:'a',subtarefaId:'mit',concluida:true});
  t=act(t,{acao:'EDITAR_SERIE',alteracoes:{titulo:'Anual',config:{recorrencia:'ANUAL',diaVencimento:20}}});
  const items=list(t);
  expect(items.map(i=>i.cicloChave)).toEqual(['2026-01','2026-02','2026-03']);
  expect(items[0].titulo).toBe('Anual');
  expect(items[1].empresas[0].subtarefas[0].concluida).toBe(true);
  expect(items[2]).toMatchObject({resolvido:true,titulo:'Apuração',dataVencimento:'2026-03-31'});
});
test('adding a checklist entry preserves completed company and personal completion until reopened',()=>{
  let t=act(tarefa(),{acao:'CONCLUIR',companyId:'a'});
  t=act(t,{acao:'EDITAR',alteracoes:{subtarefas:[...t.subtarefas,{id:'new',titulo:'Nova'}]}});
  expect(list(t)[0].empresas[0].concluida).toBe(true);
  expect(list(t)[0].empresas[1].concluida).toBe(false);
  t=act(t,{acao:'SUBTAREFA',companyId:'a',subtarefaId:'new',concluida:false});
  expect(list(t)[0].empresas[0].concluida).toBe(false);
  let p=act(tarefa({}, {empresasIds:[]}),{acao:'CONCLUIR'});
  p=act(p,{acao:'EDITAR',alteracoes:{subtarefas:[...p.subtarefas,{id:'new',titulo:'Nova'}]}});
  expect(list(p)[0].resolvido).toBe(true);
});
test('January due first appears on previous year December 31 with the same identity',()=>{
  const t=tarefa({dataInicio:'2027-01-15',diaVencimento:1});
  expect(list(t,'2026-12-31','2026-12-31')[0]).toMatchObject({id:'t:2027-01',diasAlerta:['2026-12-31','2027-01-01']});
});
