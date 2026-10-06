import { agruparAtividades, itensDasObrigacoes } from '../agendaWorkspace';
const item=(id,extra={})=>({id,tipo:'tarefa',grupoTarefaId:'g',cicloChave:'2026-10',titulo:'Conferir',dataInicio:'2026-10-06',dataFim:'2026-10-06',...extra});
test('grupo mantém progresso individual e não junta criações ou ciclos distintos',()=>{
 const grupos=agruparAtividades([item('a',{resolvido:true}),item('b'),item('c',{grupoTarefaId:'outro'}),item('d',{cicloChave:'2026-11'}),item('e',{grupoTarefaId:undefined})]);
 expect(grupos).toHaveLength(4);expect(grupos[0].itens).toHaveLength(2);expect(grupos[0].resolvido).toBe(false);
});
test('datas individuais diferentes separam os cartões sem perder o grupo',()=>{
 expect(agruparAtividades([item('a'),item('b',{dataInicio:'2026-10-07'})])).toHaveLength(2);
});
test('vínculo da série sobrevive a alterações da ocorrência',()=>{
 const itens=itensDasObrigacoes([{nome:'Conferir',tipo:'TAREFA',agendaConfig:{grupoTarefaId:'g'},ocorrencias:[{ocorrenciaId:'a',agendaConfig:{titulo:'Revisado'}}]}]);
 expect(itens[0]).toMatchObject({grupoTarefaId:'g',titulo:'Revisado'});
});
