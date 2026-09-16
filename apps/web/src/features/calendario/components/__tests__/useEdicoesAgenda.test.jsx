import { act, renderHook } from '@testing-library/react';
import { useEdicoesAgenda } from '../useEdicoesAgenda';

const tarefa = (id = 'a') => ({ id, tarefaId:id, cicloChave:'2026-09@2026-09-16', titulo:'Conferir notas', tipo:'tarefa', dataInicio:'2026-09-16', dataFim:'2026-09-16', horaInicio:'09:00', horaFim:'10:00' });
const patch = (hora = '11:00') => ({ dataInicio:'2026-09-17', dataFim:'2026-09-17', horaInicio:hora, horaFim:'13:00' });
const base = () => ({ itens:[tarefa(),tarefa('b')], obrigacoes:[] });
function pendencia() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
function montar(api) { const onErro=jest.fn(); return {...renderHook(()=>useEdicoesAgenda({api,onErro})),onErro}; }

test('move imediatamente, envia apenas período e não duplica durante resposta atrasada', async()=>{
  const p=pendencia(),api={acaoTarefaAgenda:jest.fn(()=>p.promise)}; const {result}=montar(api);let salvo;
  await act(async()=>{salvo=result.current.salvar(tarefa(),patch());});
  expect(result.current.aplicar(base()).itens).toHaveLength(2);
  expect(result.current.aplicar(base()).itens[0]).toMatchObject(patch());
  expect(result.current.pendente(tarefa())).toBe(true);
  expect(result.current.pendenteSerie({tarefaId:'a'})).toBe(true);
  expect(result.current.pendenteSerie({tarefaId:'b'})).toBe(false);
  expect(api.acaoTarefaAgenda).toHaveBeenCalledWith('a',{acao:'EDITAR',cicloChave:tarefa().cicloChave,alteracoes:patch()});
  await act(async()=>{p.resolve({ok:true});await salvo;});
  expect(result.current.pendente(tarefa())).toBe(false);
  expect(result.current.pendenteSerie({tarefaId:'a'})).toBe(false);
  expect(result.current.aplicar(base()).itens[0]).toMatchObject(patch());
});

test('serializa mesma tarefa, permite outra tarefa e falha antiga não reverte gesto mais recente', async()=>{
  const primeira=pendencia(),segunda=pendencia(),outra=pendencia();
  const api={acaoTarefaAgenda:jest.fn().mockImplementationOnce(()=>primeira.promise).mockImplementationOnce(()=>outra.promise).mockImplementationOnce(()=>segunda.promise)};
  const {result}=montar(api);let a,b,c;
  await act(async()=>{a=result.current.salvar(tarefa(),patch());});
  await act(async()=>{b=result.current.salvar({...tarefa(),...patch()},patch('12:00'));c=result.current.salvar(tarefa('b'),patch());});
  expect(api.acaoTarefaAgenda).toHaveBeenCalledTimes(2);
  expect(result.current.aplicar(base()).itens[0].horaInicio).toBe('12:00');
  await act(async()=>{primeira.reject(new Error('Sem conexão'));await a;});
  expect(api.acaoTarefaAgenda).toHaveBeenCalledTimes(3);
  expect(result.current.aplicar(base()).itens[0].horaInicio).toBe('12:00');
  await act(async()=>{segunda.resolve({ok:true});outra.resolve({ok:true});await Promise.all([b,c]);});
  expect(result.current.quantidade).toBe(0);
});

test('rollback afeta somente período e preserva conclusão recebida durante a gravação',async()=>{
  const p=pendencia(),{result}=montar({acaoTarefaAgenda:()=>p.promise});let salvo;
  await act(async()=>{salvo=result.current.salvar(tarefa(),patch());});
  const atualizado={...base(),itens:[{...tarefa(),resolvido:true,titulo:'Nome atualizado'}]};
  await act(async()=>{p.reject(new Error('Falha'));await salvo;});
  expect(result.current.aplicar(atualizado).itens[0]).toMatchObject({resolvido:true,titulo:'Nome atualizado',horaInicio:'09:00'});
});

test('consulta antiga não apaga edição; consulta posterior ao salvamento confirma o estado',async()=>{
  const p=pendencia(),{result}=montar({acaoTarefaAgenda:()=>p.promise});const antiga=result.current.capturarLeitura();let salvo;
  await act(async()=>{salvo=result.current.salvar(tarefa(),patch());});
  const durante=result.current.capturarLeitura();
  await act(async()=>{p.resolve({ok:true});await salvo;});
  act(()=>result.current.confirmarLeitura(antiga));
  act(()=>result.current.confirmarLeitura(durante));
  expect(result.current.aplicar(base()).itens[0]).toMatchObject(patch());
  const nova=result.current.capturarLeitura();act(()=>result.current.confirmarLeitura(nova));
  const confirmado={...base(),itens:[{...tarefa(),...patch(),titulo:'Editado no modal'}]};
  expect(result.current.aplicar(confirmado).itens[0].titulo).toBe('Editado no modal');
});

test('grupos sobrepostos aguardam, preservam conclusão por empresa e movem janela inteira',async()=>{
  const primeira=pendencia(),segunda=pendencia();const api={editarOcorrenciasAgenda:jest.fn().mockImplementationOnce(()=>primeira.promise).mockImplementationOnce(()=>segunda.promise)};
  const {result}=montar(api);const itens=['a','b'].map(id=>({ocorrenciaId:id,dataInicio:'2026-09-16',dataFim:'2026-09-18'}));
  const grupo={...itens[0],itens,tipo:'obrigacao'};
  const dados={itens:[],obrigacoes:itens.map(i=>({ocorrencias:[{...i,situacao:'CONCLUIDA',agendaConfig:{descricao:'Preservar'}}]}))};let a,b;
  await act(async()=>{a=result.current.salvar({...grupo,dataInicio:'2026-09-17',dataFim:'2026-09-17',atividadeOriginal:grupo},{...patch(),dataInicio:'2026-09-18',dataFim:'2026-09-18'});b=result.current.salvar({...itens[1],tipo:'obrigacao'},patch());});
  expect(api.editarOcorrenciasAgenda).toHaveBeenCalledTimes(1);
  expect(result.current.aplicar(dados).obrigacoes[0].ocorrencias[0]).toMatchObject({dataInicio:'2026-09-17',dataFim:'2026-09-19',situacao:'CONCLUIDA',agendaConfig:{descricao:'Preservar',horaInicio:'11:00'}});
  await act(async()=>{primeira.resolve({ok:true});await a;});
  expect(api.editarOcorrenciasAgenda).toHaveBeenCalledTimes(2);
  await act(async()=>{segunda.resolve({ok:true});await b;});
});
