jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../../obrigacoes/ObrigacoesService.js',()=>{const original=jest.requireActual('../../obrigacoes/ObrigacoesService.js');return {...original,sincronizarOcorrencias:jest.fn(async()=>({}))};});
import {vincularTarefasEmpresas} from '../TarefasAgendaService.js';
import {sincronizarOcorrencias} from '../../obrigacoes/ObrigacoesService.js';
const dados={titulo:'Conferir',config:{dataInicio:'2026-09-10',dataFim:'2026-09-10'},empresasIds:['a','b'],compartilhar:true};
function banco(t={config:{dataInicio:'2026-09-10',recorrencia:'AVULSA'},estados:{}}){const db={$queryRaw:jest.fn(),portalClient:{findMany:jest.fn(async()=>[{id:'a'},{id:'b'}])},obrigacao:{create:jest.fn(async({data})=>({...data,id:data.portalClientId}))},tarefaAgenda:{findFirst:jest.fn(async()=>t),update:jest.fn()}};db.$transaction=jest.fn(fn=>fn(db));return db;}
beforeEach(()=>jest.clearAllMocks());
test('cria tarefa independente por empresa autorizada em transação',async()=>{const db=banco();await vincularTarefasEmpresas({userId:'u',portalIds:['a','b'],dados},db);expect(db.obrigacao.create).toHaveBeenCalledTimes(2);expect(db.obrigacao.create).toHaveBeenCalledWith({data:expect.objectContaining({tipo:'TAREFA',portalClientId:'a',criadoPorId:'u'})});expect(sincronizarOcorrencias).toHaveBeenCalledTimes(2);});
test('empresa fora da carteira recusa todo lote',async()=>{const db=banco();await expect(vincularTarefasEmpresas({userId:'u',portalIds:['a'],dados},db)).rejects.toMatchObject({status:400});expect(db.$transaction).not.toHaveBeenCalled();});
test('sem ciência de compartilhamento recusa',async()=>{const db=banco();await expect(vincularTarefasEmpresas({userId:'u',portalIds:['a','b'],dados:{...dados,compartilhar:false}},db)).rejects.toThrow('Confirme');expect(db.obrigacao.create).not.toHaveBeenCalled();});
test('histórico pessoal impede conversão sem apagar ou criar',async()=>{const db=banco({config:{dataInicio:'2026-09-10'},estados:{x:{concluidaEm:'hoje'}}});await expect(vincularTarefasEmpresas({userId:'u',portalIds:['a','b'],dados:{...dados,tarefaId:'t'}},db)).rejects.toMatchObject({status:409});expect(db.obrigacao.create).not.toHaveBeenCalled();expect(db.tarefaAgenda.update).not.toHaveBeenCalled();});
test('conversão exige proprietário e arquiva só após criar',async()=>{const db=banco();await vincularTarefasEmpresas({userId:'u',portalIds:['a','b'],dados:{...dados,tarefaId:'t'}},db);expect(db.tarefaAgenda.findFirst).toHaveBeenCalledWith({where:{id:'t',userId:'u',excluidaEm:null}});expect(db.tarefaAgenda.update).toHaveBeenCalledWith({where:{id:'t'},data:{excluidaEm:expect.any(Date)}});});

test('setembro não converte série mensal de janeiro sem estados: conserva pendências implícitas',async()=>{
 jest.useFakeTimers().setSystemTime(new Date('2026-09-23T12:00:00Z'));
 try {const db=banco({config:{dataInicio:'2026-01-10',recorrencia:'MENSAL'},estados:{}});
 await expect(vincularTarefasEmpresas({userId:'u',portalIds:['a','b'],dados:{...dados,tarefaId:'t',config:{dataInicio:'2026-01-10',dataFim:'2026-01-10',recorrencia:'MENSAL'}}},db)).rejects.toMatchObject({status:409});
 expect(db.obrigacao.create).not.toHaveBeenCalled();expect(db.tarefaAgenda.update).not.toHaveBeenCalled();
 }finally{jest.useRealTimers();}
});
test('avulsa antiga pode preservar o intervalo completo',async()=>{
 const db=banco({config:{dataInicio:'2026-01-10',dataFim:'2026-01-15',recorrencia:'AVULSA'},estados:{}});
 await vincularTarefasEmpresas({userId:'u',portalIds:['a','b'],dados:{...dados,tarefaId:'t',config:{dataInicio:'2026-01-10',dataFim:'2026-01-15',recorrencia:'AVULSA'}}},db);
 expect(db.obrigacao.create).toHaveBeenCalledWith({data:expect.objectContaining({agendaConfig:expect.objectContaining({dataInicio:'2026-01-10',dataFim:'2026-01-15',recorrencia:'AVULSA'})})});
});
