jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
import { normalizarEntrada } from '../ObrigacoesService';
import { sincronizarAgendaConfigurada } from '../sincronizarAgendaConfigurada';
import { normalizarAgenda, expandirAgenda, ocorrenciasDaTarefa } from '../../../../../../packages/shared/src/agenda';
const config={dataInicio:'2026-09-10',dataFim:'2026-09-15',recorrencia:'MENSAL',prioridade:'ALTA'};
test('normalização preserva agenda nas obrigações',()=>expect(normalizarEntrada({nome:'EFD',periodicidade:'MENSAL',diaVencimento:21,agendaConfig:config}).agendaConfig).toMatchObject(config));
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
