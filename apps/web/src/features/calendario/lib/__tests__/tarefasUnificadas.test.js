import { prepararTarefasCalendario, projetarTarefasCalendario } from '../tarefasUnificadas';
const tarefa={id:'a:2026-10',tarefaId:'a',cicloChave:'2026-10',titulo:'Apuração',dataInicio:'2026-10-15',dataFim:'2026-10-20',dataVencimento:'2026-10-20',diasAlerta:['2026-10-19','2026-10-20'],empresas:[]};
test('um intervalo não duplica o aviso no dia em que a tarefa já aparece',()=>{
 const itens=projetarTarefasCalendario([tarefa],'2026-10-01','2026-10-31','2026-10-15');
 expect(itens).toHaveLength(6);expect(itens.filter(i=>i.alertaVencimento)).toHaveLength(2);
 expect(itens.every(i=>i.atividadeOriginal===tarefa&&i.cicloChave==='2026-10')).toBe(true);
});
test('alertas fora da janela compartilham ocorrência e aparecem antes das tarefas comuns',()=>{
 const t={...tarefa,dataFim:'2026-10-15'};
 const itens=projetarTarefasCalendario([t],'2026-10-19','2026-10-20','2026-10-15');
 expect(itens).toHaveLength(2);expect(itens.map(i=>i.alertaVencimento)).toEqual(['AMANHA','HOJE']);expect(itens.every(i=>i.projecaoAlerta)).toBe(true);
});
test('concluir elimina somente aparições automáticas, preservando a data agendada',()=>{
 const itens=projetarTarefasCalendario([{...tarefa,dataFim:'2026-10-15',resolvido:true}],'2026-10-01','2026-10-31','2026-10-21');
 expect(itens).toHaveLength(1);expect(itens[0].alertaVencimento).toBeNull();
});
test('aviso na virada do ano é incluído sem transferir a conclusão para dezembro',()=>{
 const t={...tarefa,cicloChave:'2027-01',dataInicio:'2027-01-01',dataFim:'2027-01-01',dataVencimento:'2027-01-01',diasAlerta:['2026-12-31','2027-01-01']};
 const itens=projetarTarefasCalendario([t],'2026-12-01','2026-12-31','2026-12-31');
 expect(itens[0]).toMatchObject({dataInicio:'2026-12-31',cicloChave:'2027-01',alertaVencimento:'AMANHA'});
});
test('cadastro fornece o nome sem alterar o identificador autorizado',()=>{
 const [item]=prepararTarefasCalendario([{...tarefa,empresas:[{companyId:'c'}]}],[{companyId:'c',razaoSocial:'Empresa A'}]);
 expect(item.empresas[0]).toMatchObject({companyId:'c',nome:'Empresa A'});
});
