jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../../obrigacoes/RegrasObrigacaoService.js',()=>({criarRegra:jest.fn(),empresasDoEscopo:jest.fn()}));
import { alterarTarefa, converterTarefaEmObrigacao, listarTarefas } from '../TarefasAgendaService.js';
import { criarRegra, empresasDoEscopo } from '../../obrigacoes/RegrasObrigacaoService.js';
import { normalizarAgenda, ocorrenciasDaTarefa } from '../../../../../../packages/shared/src/agenda.js';
const montar=(extra={})=>{
 const tarefa={id:'t',userId:'u',titulo:'Notas',config:normalizarAgenda({dataInicio:'2026-09-10',recorrencia:'MENSAL'}),estados:{},...extra};
 const db={$queryRaw:jest.fn(),tarefaAgenda:{findFirst:jest.fn(async()=>tarefa),update:jest.fn(async({data})=>Object.assign(tarefa,data))}};
 db.$transaction=jest.fn(fn=>fn(db));return {db,tarefa};
};
const regra={nome:'Revisão de notas',agendaConfig:{dataInicio:'2026-09-10',recorrencia:'MENSAL'},escopo:'TODAS'};
beforeEach(()=>{jest.clearAllMocks();empresasDoEscopo.mockResolvedValue([{id:'p'}]);criarRegra.mockResolvedValue({regra:{id:'r'}});});
test('editar série usa lock e filtra proprietário antes de escrever',async()=>{
 const {db,tarefa}=montar();await alterarTarefa({userId:'u',id:'t',cicloChave:'2026-09',acao:'EDITAR_SERIE',alteracoes:{recorrencia:'DIARIA'}},db);
 expect(db.$queryRaw).toHaveBeenCalledTimes(1);
 expect(db.tarefaAgenda.findFirst).toHaveBeenCalledWith({where:{id:'t',userId:'u',excluidaEm:null}});
 expect(tarefa.config.versoes[0].config.recorrencia).toBe('DIARIA');
});
test('não converte tarefa alheia e não cria regra',async()=>{
 const {db}=montar();db.tarefaAgenda.findFirst.mockResolvedValue(null);
 await expect(converterTarefaEmObrigacao({userId:'outro',id:'t',cicloChave:'2026-09',regra,portalIds:['p']},db)).rejects.toMatchObject({status:404});
 expect(criarRegra).not.toHaveBeenCalled();
});
test('converter cria regra e corta origem na mesma transação e carteira autorizada',async()=>{
 const {db,tarefa}=montar();await converterTarefaEmObrigacao({userId:'u',id:'t',cicloChave:'2026-09',regra,portalIds:['p']},db);
 expect(criarRegra).toHaveBeenCalledWith({portalIds:['p'],dados:{...regra,tipo:'OBRIGACAO'},criadoPorId:'u'},db);
 expect(db.$transaction).toHaveBeenCalledTimes(1);
 expect(ocorrenciasDaTarefa(tarefa,'2026-09-01','2027-09-01')).toEqual([]);
});
test('conversão após mover não ressuscita origem nem conserva item movido',async()=>{
 const {db,tarefa}=montar({estados:{'2026-09':{alteracoes:{dataInicio:'2026-09-20',dataFim:'2026-09-20'}}}});
 await converterTarefaEmObrigacao({userId:'u',id:'t',cicloChave:'2026-09',regra:{...regra,agendaConfig:{dataInicio:'2026-09-20',recorrencia:'MENSAL'}},portalIds:['p']},db);
 expect(tarefa.config.encerradaAPartirDe).toBe('2026-09-10');
 expect(ocorrenciasDaTarefa(tarefa,'2026-09-01','2026-10-31')).toEqual([]);
});
test.each([{concluidaEm:'2026-10-10'},{canceladaEm:'2026-10-10'},{alteracoes:{titulo:'Personalizado'}}])('histórico futuro impede conversão sem gravação: %j',async estado=>{
 const {db}=montar({estados:{'2026-10':estado}});
 await expect(converterTarefaEmObrigacao({userId:'u',id:'t',cicloChave:'2026-09',regra,portalIds:['p']},db)).rejects.toMatchObject({status:409});
 expect(criarRegra).not.toHaveBeenCalled();expect(db.tarefaAgenda.update).not.toHaveBeenCalled();
});
test('erro ao gerar regra não corta origem',async()=>{
 const {db}=montar();criarRegra.mockRejectedValue(new Error('falha'));
 await expect(converterTarefaEmObrigacao({userId:'u',id:'t',cicloChave:'2026-09',regra,portalIds:['p']},db)).rejects.toThrow('falha');
 expect(db.tarefaAgenda.update).not.toHaveBeenCalled();
});
test('carteira sem empresa elegível não converte',async()=>{
 const {db}=montar();empresasDoEscopo.mockResolvedValue([]);
 await expect(converterTarefaEmObrigacao({userId:'u',id:'t',cicloChave:'2026-09',regra,portalIds:['p']},db)).rejects.toMatchObject({code:'escopo_vazio'});
 expect(criarRegra).not.toHaveBeenCalled();
});

test('consulta antecipa mês seguinte, considera feriados cadastrados e preserva horário',async()=>{
 const {db,tarefa}=montar({config:normalizarAgenda({dataInicio:'2026-11-01',recorrencia:'MENSAL',ajusteDiaUtil:'ANTECIPAR',horaInicio:'09:00',horaFim:'10:00'})});
 db.tarefaAgenda.findMany=jest.fn(async()=>[tarefa]); db.agendaOcultacao={findMany:jest.fn(async()=>[])};
 db.feriado={findMany:jest.fn(async()=>[{data:new Date('2026-10-30'),abrangencia:'NACIONAL'},{data:new Date('2026-10-29'),abrangencia:'MUNICIPAL',municipio:'Outra cidade'}])};
 const {itens}=await listarTarefas({userId:'u',inicio:'2026-10-01',fim:'2026-10-31'},db);
 expect(itens).toHaveLength(1);
 expect(itens[0]).toMatchObject({cicloChave:'2026-11',dataInicio:'2026-10-29',dataInicioOriginal:'2026-11-01',horaInicio:'09:00',horaFim:'10:00'});
 expect(db.tarefaAgenda.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{userId:'u',excluidaEm:null}}));
 await alterarTarefa({userId:'u',id:'t',cicloChave:'2026-11',acao:'CONCLUIR'},db);
 expect((await listarTarefas({userId:'u',inicio:'2026-10-01',fim:'2026-10-31'},db)).itens[0].resolvido).toBe(true);
 await alterarTarefa({userId:'u',id:'t',cicloChave:'2026-11',acao:'EDITAR',alteracoes:{dataInicio:'2026-11-02',dataFim:'2026-11-02'}},db);
 expect((await listarTarefas({userId:'u',inicio:'2026-10-01',fim:'2026-10-31'},db)).itens).toEqual([]);
 expect((await listarTarefas({userId:'u',inicio:'2026-11-01',fim:'2026-11-30'},db)).itens[0]).toMatchObject({dataInicio:'2026-11-02',resolvido:true});
});

test('ativar antecipação na série carrega feriados antes de expandir a nova versão',async()=>{
 const {db,tarefa}=montar({config:normalizarAgenda({dataInicio:'2026-11-01',recorrencia:'MENSAL'})});
 db.feriado={findMany:jest.fn(async()=>[{data:new Date('2026-10-30'),abrangencia:'NACIONAL'}])};
 await alterarTarefa({userId:'u',id:'t',cicloChave:'2026-11',acao:'EDITAR_SERIE',alteracoes:{ajusteDiaUtil:'ANTECIPAR'}},db);
 expect(db.feriado.findMany).toHaveBeenCalledTimes(1);
 expect(tarefa.config.versoes[0].config).toMatchObject({ajusteDiaUtil:'ANTECIPAR',dataInicio:'2026-11-01'});
});
