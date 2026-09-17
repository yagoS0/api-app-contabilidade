import { criarMockAgenda } from '../agendaMock';
const criar=async()=>{
 const api=criarMockAgenda([],[]);
 const {tarefa}=await api.salvarTarefaAgenda({titulo:'Notas',config:{dataInicio:'2026-09-10',horaInicio:'09:00',horaFim:'10:00',recorrencia:'AVULSA'}});
 return {api,tarefa};
};
test('mock edita recorrência e permite concluir/reabrir ocorrência da nova versão',async()=>{
 const {api,tarefa}=await criar();
 await api.acaoTarefaAgenda(tarefa.id,{acao:'EDITAR_SERIE',cicloChave:'2026-09-10',alteracoes:{recorrencia:'MENSAL'}});
 let {itens}=await api.getTarefasAgenda('2026-09-01','2026-11-30');expect(itens).toHaveLength(3);
 await api.acaoTarefaAgenda(tarefa.id,{acao:'CONCLUIR',cicloChave:itens[1].cicloChave});
 expect((await api.getTarefasAgenda('2026-10-01','2026-10-31')).itens[0].resolvido).toBe(true);
 await api.acaoTarefaAgenda(tarefa.id,{acao:'REABRIR',cicloChave:itens[1].cicloChave});
 expect((await api.getTarefasAgenda('2026-10-01','2026-10-31')).itens[0].resolvido).toBe(false);
});
test('mock converte movida e remove origem somente após criar regra',async()=>{
 const {api,tarefa}=await criar();
 api.previewEscopoRegra=jest.fn(async()=>({total:2}));api.createRegraObrigacao=jest.fn(async()=>({ok:true,regra:{id:'r'}}));
 await api.acaoTarefaAgenda(tarefa.id,{acao:'EDITAR',cicloChave:'2026-09-10',alteracoes:{dataInicio:'2026-09-20',dataFim:'2026-09-20'}});
 await api.converterTarefaEmObrigacao(tarefa.id,{cicloChave:'2026-09-10',regra:{escopo:'TODAS',agendaConfig:{dataInicio:'2026-09-20'}}});
 expect((await api.getTarefasAgenda('2026-09-01','2026-09-30')).itens).toEqual([]);
 expect(api.createRegraObrigacao).toHaveBeenCalledTimes(1);
});
test('erro ao criar regra mantém tarefa no mock',async()=>{
 const {api,tarefa}=await criar();api.previewEscopoRegra=jest.fn(async()=>({total:2}));api.createRegraObrigacao=jest.fn(async()=>{throw new Error('falha');});
 await expect(api.converterTarefaEmObrigacao(tarefa.id,{cicloChave:'2026-09-10',regra:{escopo:'TODAS',agendaConfig:{dataInicio:'2026-09-10'}}})).rejects.toThrow('falha');
 expect((await api.getTarefasAgenda('2026-09-01','2026-09-30')).itens).toHaveLength(1);
});
