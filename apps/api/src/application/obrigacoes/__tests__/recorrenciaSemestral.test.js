jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));

import { expandirAgenda, ocorrenciasDaTarefa } from '../../../../../../packages/shared/src/agenda';
import { normalizarEntrada } from '../ObrigacoesService';
import { normalizarRegraRecorrente } from '../agendaSerie';
import { calcularVencimentos, mesesDaJanela } from '../gerarOcorrencias';
import { sincronizarAgendaConfigurada } from '../sincronizarAgendaConfigurada';

const agenda = { dataInicio: '2027-08-31', dataFim: '2027-08-31', recorrencia: 'SEMESTRAL' };

test('semestre usa seis meses civis, limita fevereiro e retoma o dia 31', () => {
  const itens = expandirAgenda(agenda, '2027-01-01', '2029-01-01');
  expect(itens.map(i => i.dataInicio)).toEqual(['2027-08-31', '2028-02-29', '2028-08-31']);
  expect(itens.map(i => i.cicloChave)).toEqual(['2027-08', '2028-02', '2028-08']);
  expect(expandirAgenda(agenda, '2028-03-01', '2028-09-01').map(i => i.dataInicio)).toEqual(['2028-08-31']);
});

test('limite da repetição inclui o último início e mantém o fim da janela', () => {
  const config = { ...agenda, dataInicio: '2027-08-28', dataFim: '2027-09-03', repetirAte: '2028-02-28' };
  expect(expandirAgenda(config, '2027-08-01', '2028-09-30').map(i => [i.dataInicio, i.dataFim])).toEqual([
    ['2027-08-28', '2027-09-03'], ['2028-02-28', '2028-03-03'],
  ]);
  expect(expandirAgenda({ ...config, repetirAte: '2028-02-27' }, '2028-02-01', '2028-09-30')).toEqual([]);
});

test('semestre com horário mantém conclusão e cancelamento por dia sem duplicar o ciclo', () => {
  const tarefa = { id: 't', config: { ...agenda, dataInicio: '2027-08-10', dataFim: '2027-08-12', horaInicio: '09:00', horaFim: '10:00' },
    estados: { '2028-02@2028-02-10': { concluidaEm: '2028-02-10' }, '2028-02@2028-02-11': { canceladaEm: '2028-02-10' } } };
  const itens = ocorrenciasDaTarefa(tarefa, '2028-02-01', '2028-08-31');
  expect(itens.map(i => i.dataInicio)).toEqual(['2028-02-10', '2028-02-12', '2028-08-10', '2028-08-11', '2028-08-12']);
  expect(itens.filter(i => i.resolvido)).toHaveLength(1);
  expect(itens.every(i => i.horaInicio === '09:00' && i.horaFim === '10:00' && i.dataInicio === i.dataFim)).toBe(true);
});

test('obrigação semestral aceita o mês de referência e exige-o no cadastro e na edição', () => {
  const base = { nome: 'Revisão semestral', periodicidade: 'SEMESTRAL', diaVencimento: 31, mesReferencia: 8, ajusteDiaUtil: 'MANTER', agendaConfig: agenda };
  expect(normalizarEntrada(base)).toMatchObject({ periodicidade: 'SEMESTRAL', mesReferencia: 8, agendaConfig: agenda });
  expect(normalizarRegraRecorrente({ periodicidade: 'SEMESTRAL', mesReferencia: 8 }, base)).toMatchObject({ periodicidade: 'SEMESTRAL', mesReferencia: 8 });
  expect(() => normalizarEntrada({ ...base, mesReferencia: null })).toThrow('ciclo semestral');
  expect(() => normalizarRegraRecorrente({ mesReferencia: null }, base)).toThrow('mês de referência');
});

test('gerador fiscal conserva a âncora semestral quando a consulta começa entre ciclos', () => {
  expect(mesesDaJanela('SEMESTRAL', 8, { ano: 2027, mes: 9 }, 12)).toEqual([{ ano: 2028, mes: 2 }, { ano: 2028, mes: 8 }]);
  expect(() => mesesDaJanela('SEMESTRAL', null, { ano: 2028, mes: 1 }, 12)).toThrow('mes_referencia_obrigatorio');
  const itens = calcularVencimentos({ periodicidade: 'SEMESTRAL', mesReferencia: 8, diaVencimento: 31, ajusteDiaUtil: 'MANTER', defasagemMeses: 1 }, { inicio: { ano: 2027, mes: 9 }, quantidadeMeses: 12 });
  expect(itens.map(i => [i.iso, i.competenciaRef])).toEqual([['2028-02-29', '2028-01'], ['2028-08-31', '2028-07']]);
});

test('sincronização semestral separa prazo fiscal e janela, preservando estados existentes', async () => {
  const config = { dataInicio: '2027-08-10', dataFim: '2027-08-15', recorrencia: 'SEMESTRAL', repetirAte: '2028-08-10' };
  const existentes = [
    { id: 'c', cicloChave: '2027-08', dataVencimento: new Date('2027-08-31'), canceladaEm: new Date(), status: 'PENDENTE' },
    { id: 'f', cicloChave: '2028-02', dataVencimento: new Date('2028-02-29'), status: 'CONCLUIDA' },
  ];
  const db = { ocorrenciaObrigacao: { findMany: async () => existentes, createMany: jest.fn(async ({ data }) => ({ count: data.length })), update: jest.fn() }, portalClient: { findUnique: async () => null }, feriado: { findMany: async () => [] } };
  await sincronizarAgendaConfigurada(db, { id: 's', tipo: 'OBRIGACAO', agendaConfig: config, periodicidade: 'SEMESTRAL', diaVencimento: 31, mesReferencia: 8, ajusteDiaUtil: 'MANTER' }, { hoje: new Date('2027-08-10') });
  expect(db.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
  expect(db.ocorrenciaObrigacao.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ cicloChave: '2028-08', dataInicio: new Date('2028-08-10'), dataFim: new Date('2028-08-15'), dataVencimento: new Date('2028-08-31'), competenciaRef: '2028-07' })]);
});
