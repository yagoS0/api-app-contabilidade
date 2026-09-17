import { normalizarAgenda, ocorrenciasDaTarefa, prepararEdicaoSerieTarefa, encontrarOcorrenciaDaTarefa } from '../../../../../../packages/shared/src/agenda.js';

const nova = (config={}) => ({id:'t',titulo:'Conferência',descricao:'Notas',config:normalizarAgenda({dataInicio:'2026-09-10',horaInicio:'09:00',horaFim:'10:00',recorrencia:'MENSAL',...config}),estados:{}});
const listar = t => ocorrenciasDaTarefa(t,'2026-09-01','2027-09-30');
const editar = (t,chave,patch) => Object.assign(t,prepararEdicaoSerieTarefa(t,chave,patch));

test('mudar avulsa em mensal mantém uma ocorrência inicial e gera os meses seguintes',()=>{
 const t=nova({recorrencia:'AVULSA'});editar(t,'2026-09-10',{recorrencia:'MENSAL'});
 expect(listar(t).slice(0,3).map(i=>i.dataInicio)).toEqual(['2026-09-10','2026-10-10','2026-11-10']);
 expect(listar(t).filter(i=>i.dataInicio==='2026-09-10')).toHaveLength(1);
});
test('conclusões, exclusões e exceções futuras sobrevivem mensal para diária sem duplicar datas',()=>{
 const t=nova();t.estados={'2026-09':{concluidaEm:'2026-09-10'},'2026-11':{canceladaEm:'2026-11-01'},'2026-12':{alteracoes:{dataInicio:'2026-12-11',dataFim:'2026-12-11',horaInicio:'12:00'}}};
 editar(t,'2026-10',{recorrencia:'DIARIA'});
 const itens=listar(t);
 expect(itens.find(i=>i.cicloChave==='2026-09')).toMatchObject({resolvido:true,dataInicio:'2026-09-10'});
 expect(itens.some(i=>i.dataInicio==='2026-11-10')).toBe(false);
 expect(itens.filter(i=>i.dataInicio==='2026-12-11')).toHaveLength(1);
 expect(itens.find(i=>i.cicloChave==='2026-12')).toMatchObject({horaInicio:'12:00'});
 expect(encontrarOcorrenciaDaTarefa(t,'v1|2026-10-11')).toMatchObject({dataInicio:'2026-10-11'});
});
test('trocar uma ocorrência já movida não restaura a data de origem',()=>{
 const t=nova();t.estados={'2026-09':{alteracoes:{dataInicio:'2026-09-15',dataFim:'2026-09-15'}}};
 editar(t,'2026-09',{recorrencia:'SEMANAL'});
 expect(listar(t).some(i=>i.dataInicio==='2026-09-10')).toBe(false);
 expect(listar(t)[0].dataInicio).toBe('2026-09-15');
});
test('editar segundo dia da janela horária conserva o primeiro e substitui seguintes',()=>{
 const t=nova({dataFim:'2026-09-15'});editar(t,'2026-09@2026-09-11',{recorrencia:'SEMANAL'});
 const setembro=listar(t).filter(i=>i.dataInicio<'2026-10-01');
 expect(setembro.map(i=>i.dataInicio)).toEqual(['2026-09-10','2026-09-11','2026-09-18','2026-09-25']);
});
test('edição seguinte sobrescreve agenda futura mas preserva item antigo concluído',()=>{
 const t=nova();editar(t,'2026-09',{recorrencia:'SEMANAL'});t.estados['v1|2026-09-17']={concluidaEm:'2026-09-17'};
 editar(t,'v1|2026-09-24',{recorrencia:'ANUAL',titulo:'Conferência anual'});
 expect(listar(t).find(i=>i.dataInicio==='2026-09-17').resolvido).toBe(true);
 expect(listar(t).find(i=>i.dataInicio==='2026-09-24').titulo).toBe('Conferência anual');
 expect(listar(t).filter(i=>i.dataInicio>'2026-09-24').map(i=>i.dataInicio)).toEqual(['2027-09-24']);
});
test.each([{concluidaEm:'2026-10-16'},{canceladaEm:'2026-10-16'}])('estado no ciclo inteiro preserva todos os dias da janela: %j',estado=>{
 const t=nova({dataFim:'2026-09-15'});t.estados['2026-10']=estado;
 editar(t,'2026-09@2026-09-10',{recorrencia:'DIARIA'});
 const outubro=listar(t).filter(i=>i.dataInicio>='2026-10-10' && i.dataInicio<='2026-10-15');
 expect(outubro).toHaveLength(estado.canceladaEm?0:6);
 if(estado.concluidaEm) expect(outubro.every(i=>i.resolvido)).toBe(true);
});
test('exceção preservada ainda pode mudar de data sem duplicar e sobrevive nova versão',()=>{
 const t=nova();t.estados['2026-11']={concluidaEm:'2026-11-10'};
 editar(t,'2026-09',{recorrencia:'DIARIA'});
 t.estados['2026-11'].alteracoes={dataInicio:'2026-11-11',dataFim:'2026-11-11'};
 expect(listar(t).filter(i=>i.dataInicio==='2026-11-11')).toHaveLength(1);
 expect(listar(t).some(i=>i.dataInicio==='2026-11-10')).toBe(false);
 editar(t,'v1|2026-10-10',{recorrencia:'MENSAL'});
 expect(listar(t).find(i=>i.cicloChave==='2026-11')).toMatchObject({dataInicio:'2026-11-11',resolvido:true});
});
