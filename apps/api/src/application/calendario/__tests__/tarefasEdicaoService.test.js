jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../../obrigacoes/RegrasObrigacaoService.js',()=>({criarRegra:jest.fn(),empresasDoEscopo:jest.fn()}));
import { alterarTarefa, converterTarefaEmObrigacao } from '../TarefasAgendaService.js';
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
