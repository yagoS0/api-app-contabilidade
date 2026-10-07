jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
import { normalizarEntrada } from '../ObrigacoesService';
import { sincronizarAgendaConfigurada } from '../sincronizarAgendaConfigurada';
import { normalizarAgenda, expandirAgenda, ocorrenciasDaTarefa, encontrarOcorrenciaDaTarefa } from '../../../../../../packages/shared/src/agenda';
const config={dataInicio:'2026-09-10',dataFim:'2026-09-15',recorrencia:'MENSAL',prioridade:'ALTA'};

test('tarefa mensal de 10 a 15 gera seis dias independentes em cada mês',()=>{
  const tarefa={id:'t',titulo:'Conferir NFS-e',config:{...config,horaInicio:'09:00',horaFim:'11:00'},estados:{}};
  const itens=ocorrenciasDaTarefa(tarefa,'2026-09-01','2026-10-31');
  expect(itens).toHaveLength(12);expect(new Set(itens.map(i=>i.id)).size).toBe(12);
  expect(itens.every(i=>i.dataInicio===i.dataFim && i.horaInicio==='09:00' && i.horaFim==='11:00')).toBe(true);
  expect(itens.slice(0,6).map(i=>i.dataInicio)).toEqual(['2026-09-10','2026-09-11','2026-09-12','2026-09-13','2026-09-14','2026-09-15']);
  tarefa.estados[itens[2].cicloChave]={canceladaEm:'agora'};
  tarefa.estados[itens[1].cicloChave]={concluidaEm:'agora'};
  tarefa.estados[itens[3].cicloChave]={alteracoes:{horaInicio:'14:00',horaFim:'15:00'}};
  const restante=ocorrenciasDaTarefa(tarefa,'2026-09-01','2026-10-31');
  expect(restante).toHaveLength(11);expect(restante.filter(i=>i.resolvido)).toHaveLength(1);
  expect(restante.filter(i=>i.horaInicio==='14:00')).toHaveLength(1);
  expect(encontrarOcorrenciaDaTarefa(tarefa,itens[3].cicloChave).horaInicio).toBe('14:00');
  expect(encontrarOcorrenciaDaTarefa(tarefa,'2026-09@2026-09-30')).toBeUndefined();
});

test('editar tarefa avulsa para janela cria dias e preserva exceções movidas fora do mês',()=>{
  const tarefa={id:'t',titulo:'NFS-e',config:{dataInicio:'2026-09-10',dataFim:'2026-09-10',horaInicio:'09:00',horaFim:'11:00'},estados:{'2026-09-10':{alteracoes:{dataFim:'2026-09-15'}}}};
  const dias=ocorrenciasDaTarefa(tarefa,'2026-09-01','2026-09-30');expect(dias).toHaveLength(6);
  tarefa.estados[dias[2].cicloChave]={alteracoes:{dataInicio:'2026-11-01',dataFim:'2026-11-02'}};
  const movidas=ocorrenciasDaTarefa(tarefa,'2026-11-01','2026-11-30');expect(movidas).toHaveLength(2);
  tarefa.estados[movidas[0].cicloChave]={canceladaEm:'agora'};
  expect(ocorrenciasDaTarefa(tarefa,'2026-11-01','2026-11-30').map(i=>i.dataInicio)).toEqual(['2026-11-02']);
  expect(ocorrenciasDaTarefa(tarefa,'2026-09-01','2026-09-30')).toHaveLength(5);
  expect(encontrarOcorrenciaDaTarefa(tarefa,movidas[1].cicloChave).dataInicio).toBe('2026-11-02');
});

test('janelas sem horário e cancelamentos antigos conservam seu comportamento',()=>{
  expect(ocorrenciasDaTarefa({id:'t',config,estados:{}},'2026-09-01','2026-09-30')).toHaveLength(1);
  expect(ocorrenciasDaTarefa({id:'t',config:{...config,horaInicio:'09:00',horaFim:'11:00'},estados:{'2026-09':{canceladaEm:'agora'}}},'2026-09-01','2026-09-30')).toHaveLength(0);
});
test('normalização preserva agenda nas obrigações',()=>expect(normalizarEntrada({nome:'EFD',periodicidade:'MENSAL',diaVencimento:21,agendaConfig:config}).agendaConfig).toMatchObject(config));

test('horário fixo repete sem inventar duração e aceita alteração para intervalo',()=>{
  const c=normalizarAgenda({...config,dataFim:config.dataInicio,horaInicio:'09:30'});
  expect(c).toMatchObject({horaInicio:'09:30',horaFim:null});
  expect(expandirAgenda(c,'2026-09-01','2026-10-31')).toHaveLength(2);
  const tarefa={id:'t',titulo:'Conferir NFS-e',config:c,estados:{'2026-09':{alteracoes:{horaInicio:'10:00',horaFim:'11:00'}}}};
  expect(ocorrenciasDaTarefa(tarefa,'2026-09-01','2026-10-31').map(o=>[o.horaInicio,o.horaFim])).toEqual([['10:00','11:00'],['09:30',null]]);
  expect(()=>normalizarAgenda({...c,horaInicio:null,horaFim:'10:00'})).toThrow('Informe o horário inicial.');
});
test.each(['DIARIA','SEMANAL','MENSAL','TRIMESTRAL','ANUAL'])('expande %s sem gerar antes da âncora',recorrencia=>{
  const out=expandirAgenda({...config,recorrencia},'2026-09-01','2027-10-01');expect(out.length).toBeGreaterThan(1);expect(out.every(o=>o.dataInicio>='2026-09-10')).toBe(true);expect(new Set(out.map(o=>o.cicloChave)).size).toBe(out.length);
});
test('dias inexistentes usam fim de mês e retomam o dia original',()=>{
  const out=expandirAgenda({dataInicio:'2024-01-31',dataFim:'2024-01-31',recorrencia:'MENSAL'},'2024-01-01','2024-03-31');expect(out.map(o=>o.dataInicio)).toEqual(['2024-01-31','2024-02-29','2024-03-31']);
});
test('intervalo entre meses permanece contínuo e aparece no mês seguinte',()=>{
  const out=expandirAgenda({dataInicio:'2026-12-28',dataFim:'2027-01-03',recorrencia:'MENSAL'},'2027-01-01','2027-01-31');expect(out).toHaveLength(2);expect(out[0]).toMatchObject({dataInicio:'2026-12-28',dataFim:'2027-01-03'});
});
test('repetir até limita inícios e aceita o fim da última ocorrência',()=>expect(expandirAgenda({...config,repetirAte:'2026-10-10'},'2026-09-01','2027-01-31')).toHaveLength(2));
test.each([{dataInicio:'2026-02-30'},{...config,dataFim:'2026-09-09'},{...config,horaInicio:'14:00',horaFim:'13:00',dataFim:'2026-09-10'}])('recusa período inválido',c=>expect(()=>normalizarAgenda(c)).toThrow());
test('ocorrência movida aparece no destino e cancelada não ressuscita',()=>{
  const tarefa={id:'t',titulo:'NFS-e',config,estados:{'2026-09':{alteracoes:{dataInicio:'2026-11-01',dataFim:'2026-11-02'}},'2026-11':{canceladaEm:'2026-09-01'}}};
  const out=ocorrenciasDaTarefa(tarefa,'2026-11-01','2026-11-30');expect(out.map(o=>o.cicloChave)).toEqual(['2026-09']);
});
test('sincronização preserva canceladas e concluídas e separa janela do prazo',async()=>{
  const existentes=[{id:'c',cicloChave:'2026-09',dataVencimento:new Date('2026-09-21'),canceladaEm:new Date(),status:'PENDENTE'},{id:'f',cicloChave:'2026-10',dataVencimento:new Date('2026-10-21'),status:'CONCLUIDA'}];
  const db={ocorrenciaObrigacao:{findMany:async()=>existentes,createMany:jest.fn(async({data})=>({count:data.length})),update:jest.fn()},portalClient:{findUnique:async()=>null},feriado:{findMany:async()=>[]}};
  await sincronizarAgendaConfigurada(db,{id:'s',agendaConfig:config,periodicidade:'MENSAL',tipo:'OBRIGACAO',diaVencimento:21,ajusteDiaUtil:'MANTER'},{hoje:new Date('2026-09-10')});
  expect(db.ocorrenciaObrigacao.update).not.toHaveBeenCalled();const chamadas=db.ocorrenciaObrigacao.createMany.mock.calls.flatMap(([x])=>x.data);expect(chamadas[0]).toMatchObject({cicloChave:'2026-11',dataInicio:new Date('2026-11-10'),dataFim:new Date('2026-11-15'),dataVencimento:new Date('2026-11-21')});
});

const date = value => new Date(value);
const bancoAgenda = ({ existentes = [], municipio = 'São Paulo', feriados = [] } = {}) => ({
  ocorrenciaObrigacao: {
    findMany: jest.fn(async () => existentes),
    createMany: jest.fn(async ({ data }) => ({ count: data.length })),
    update: jest.fn(async () => ({})),
  },
  portalClient: { findUnique: jest.fn(async () => ({ municipio })) },
  feriado: { findMany: jest.fn(async () => feriados) },
});
const novasDoBanco = db => db.ocorrenciaObrigacao.createMany.mock.calls.flatMap(([{ data }]) => data);

test('adotar janela mensal em ISS legado não oculta ciclos que acabou de reconciliar',async()=>{
  const existente={id:'iss-nov',cicloChave:null,dataInicio:date('2026-11-05'),dataFim:date('2026-11-05'),dataVencimento:date('2026-11-05'),status:'PENDENTE'};
  const db=bancoAgenda({existentes:[existente]});
  await sincronizarAgendaConfigurada(db,{id:'iss',tipo:'OBRIGACAO',periodicidade:'MENSAL',diaVencimento:5,ajusteDiaUtil:'MANTER',defasagemMeses:1,agendaConfig:{dataInicio:'2026-10-01',dataFim:'2026-10-05',recorrencia:'MENSAL'}},{hoje:date('2026-10-06')});
  const alteracoes=db.ocorrenciaObrigacao.update.mock.calls.map(([x])=>x);
  expect(alteracoes.filter(x=>x.where.id==='iss-nov')).toEqual([expect.objectContaining({data:expect.objectContaining({cicloChave:'2026-11',dataInicio:date('2026-11-01'),dataFim:date('2026-11-05'),foraDaRecorrencia:false})})]);
  expect(novasDoBanco(db).some(o=>o.cicloChave==='2026-11')).toBe(false);
});
const serieUtil = (agenda = {}, extra = {}) => ({
  id: 's', portalClientId: 'p', tipo: 'OBRIGACAO', periodicidade: 'MENSAL', diaVencimento: 20,
  ajusteDiaUtil: 'MANTER', defasagemMeses: 1,
  agendaConfig: { dataInicio: '2027-01-02', dataFim: '2027-01-02', recorrencia: 'MENSAL', ajusteDiaUtil: 'ANTECIPAR', ...agenda }, ...extra,
});

test('antecipação cruza ano conservando competência e prazo fiscal nominal', async () => {
  const db = bancoAgenda({ feriados: [{ data: date('2027-01-01'), abrangencia: 'NACIONAL' }] });
  await sincronizarAgendaConfigurada(db, serieUtil(), { hoje: date('2026-12-01') });
  expect(novasDoBanco(db)[0]).toMatchObject({ cicloChave: '2027-01', dataInicio: date('2026-12-31'), dataFim: date('2026-12-31'), dataVencimento: date('2027-01-20'), competenciaRef: '2026-12' });
});

test.each([['São Paulo', '2026-07-08'], ['Curitiba', '2026-07-09']])('feriado municipal só ajusta agenda da empresa correspondente: %s', async (municipio, esperada) => {
  const db = bancoAgenda({ municipio, feriados: [{ data: date('2026-07-09'), abrangencia: 'MUNICIPAL', municipio: 'São Paulo' }] });
  await sincronizarAgendaConfigurada(db, serieUtil({ dataInicio: '2026-07-09', dataFim: '2026-07-09' }), { hoje: date('2026-07-01') });
  expect(novasDoBanco(db)[0].dataInicio).toEqual(date(esperada));
});

test('avulsa antecipada permanece presente e preserva prazo independente da janela', async () => {
  const db = bancoAgenda();
  await sincronizarAgendaConfigurada(db, serieUtil({ recorrencia: 'AVULSA', dataInicio: '2026-10-10', dataFim: '2026-10-10' }, { periodicidade: 'AVULSA' }), { hoje: date('2026-10-01') });
  expect(novasDoBanco(db)).toHaveLength(1);
  expect(novasDoBanco(db)[0]).toMatchObject({ cicloChave: '2026-10-10', dataInicio: date('2026-10-09'), dataVencimento: date('2026-10-10') });
});

test('janela temporizada guarda todos os dias nominais com antecipações calculadas no servidor', async () => {
  const db = bancoAgenda({ feriados: [{ data: date('2026-10-12'), abrangencia: 'NACIONAL' }] });
  await sincronizarAgendaConfigurada(db, serieUtil({ dataInicio: '2026-10-09', dataFim: '2026-10-12', horaInicio: '09:00', horaFim: '11:00' }), { hoje: date('2026-10-01') });
  expect(novasDoBanco(db)[0].agendaConfig).toEqual({
    dataInicioOriginal: '2026-10-09', dataFimOriginal: '2026-10-12',
    diasAgendados: ['09', '10', '11', '12'].map(dia => ({ dataInicio: '2026-10-09', dataFim: '2026-10-09', dataInicioOriginal: `2026-10-${dia}` })),
  });
});

test('sincronizar não altera conclusão, cancelamento ou janela personalizada', async () => {
  const existentes = [
    { id: '1', cicloChave: '2027-01', status: 'CONCLUIDA' },
    { id: '2', cicloChave: '2027-02', status: 'PENDENTE', canceladaEm: date('2026-12-01') },
    { id: '3', cicloChave: '2027-03', status: 'PENDENTE', janelaPersonalizada: true },
  ].map(o => ({ dataInicio: date(`${o.cicloChave}-02`), dataFim: date(`${o.cicloChave}-02`), dataVencimento: date(`${o.cicloChave}-20`), ...o }));
  const db = bancoAgenda({ existentes });
  await sincronizarAgendaConfigurada(db, serieUtil(), { hoje: date('2026-12-01') });
  expect(db.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
  expect(novasDoBanco(db).some(o => existentes.some(e => e.cicloChave === o.cicloChave))).toBe(false);
});

test('reconciliar antecipação que voltou para antes de hoje não oculta ocorrência existente', async () => {
  const db = bancoAgenda({ existentes: [{ id: '1', cicloChave: '2026-10', status: 'PENDENTE', dataInicio: date('2026-10-10'), dataFim: date('2026-10-10'), dataVencimento: date('2026-10-20') }] });
  await sincronizarAgendaConfigurada(db, serieUtil({ dataInicio: '2026-09-10', dataFim: '2026-09-10' }), { hoje: date('2026-10-10') });
  expect(db.ocorrenciaObrigacao.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: '1' }, data: expect.objectContaining({ dataInicio: date('2026-10-09'), foraDaRecorrencia: false }) }));
  expect(db.ocorrenciaObrigacao.update.mock.calls.some(([arg]) => arg.data.foraDaRecorrencia === true)).toBe(false);
});

test('desativar antecipação limpa metadados derivados e conserva ajustes de horário individuais', async () => {
  const db = bancoAgenda({ existentes: [{ id: '1', cicloChave: '2026-10', status: 'PENDENTE', dataInicio: date('2026-10-09'), dataFim: date('2026-10-09'), dataVencimento: date('2026-10-20'), agendaConfig: { dataInicioOriginal: '2026-10-10', dataFimOriginal: '2026-10-10', diasAgendados: [], horaInicio: '14:00' } }] });
  await sincronizarAgendaConfigurada(db, serieUtil({ dataInicio: '2026-10-10', dataFim: '2026-10-10', ajusteDiaUtil: 'MANTER' }), { hoje: date('2026-10-01') });
  expect(db.ocorrenciaObrigacao.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dataInicio: date('2026-10-10'), agendaConfig: { horaInicio: '14:00' } }) }));
});

test('tarefas diárias antecipadas compartilham janela sem colidir na chave única do prazo', async () => {
  const db = bancoAgenda();
  db.ocorrenciaObrigacao.createMany.mockImplementation(async ({ data }) => {
    const chaves = data.map(d => `${d.obrigacaoId}|${d.dataVencimento.toISOString()}`);
    if (new Set(chaves).size !== chaves.length) throw new Error('P2002: obrigacaoId,dataVencimento');
    return { count: data.length };
  });
  await sincronizarAgendaConfigurada(db, serieUtil({ dataInicio: '2026-10-09', dataFim: '2026-10-09', recorrencia: 'DIARIA', repetirAte: '2026-10-11' }, { tipo: 'TAREFA', periodicidade: 'DIARIA' }), { hoje: date('2026-10-01') });
  const criadas = novasDoBanco(db);
  expect(criadas).toHaveLength(3);
  expect(criadas.every(o => o.dataInicio.toISOString().startsWith('2026-10-09'))).toBe(true);
  expect(criadas.map(o => o.dataVencimento.toISOString().slice(0, 10))).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
});


test('geração posterior respeita corte anterior e posterior, inclusive primeira ocorrência',async()=>{
 const db={ocorrenciaObrigacao:{findMany:async()=>[],createMany:jest.fn(async({data})=>({count:data.length})),update:jest.fn()},portalClient:{findUnique:async()=>null},feriado:{findMany:async()=>[]}};
 await sincronizarAgendaConfigurada(db,{id:'s',tipo:'TAREFA',periodicidade:'MENSAL',agendaConfig:config,excluidaAteCiclo:'2026-10',encerradaAPartirDe:'2027-01'},{hoje:new Date('2026-09-01'),incluirVencidoDoMes:true});
 expect(db.ocorrenciaObrigacao.createMany.mock.calls[0][0].data.map(o=>o.cicloChave)).toEqual(['2026-11','2026-12']);
});
