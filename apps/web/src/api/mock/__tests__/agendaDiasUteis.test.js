import { criarMockAgenda } from '../agendaMock';
import { createMockApi } from '../mockApi';
import { blocosDiarios, itensDasObrigacoes } from '../../../features/calendario/lib/agendaWorkspace';

beforeEach(() => { jest.useFakeTimers({ doNotFake: ['setTimeout'] }); jest.setSystemTime(new Date('2026-09-01T12:00:00Z')); });
afterEach(() => jest.useRealTimers());

test('mock pessoal considera feriado em listagem, conclusão e edição de série', async () => {
  const api = criarMockAgenda([], [], data => data === '2026-09-07');
  const { tarefa } = await api.salvarTarefaAgenda({ titulo: 'Conferir notas', config: { dataInicio: '2026-09-07', recorrencia: 'MENSAL', ajusteDiaUtil: 'ANTECIPAR', horaInicio: '09:00', horaFim: '10:00' } });
  let { itens } = await api.getTarefasAgenda('2026-09-01', '2026-09-30');
  expect(itens[0]).toMatchObject({ dataInicio: '2026-09-04', dataInicioOriginal: '2026-09-07' });
  await api.acaoTarefaAgenda(tarefa.id, { acao: 'CONCLUIR', cicloChave: itens[0].cicloChave });
  expect((await api.getTarefasAgenda('2026-09-01', '2026-09-30')).itens[0].resolvido).toBe(true);
  await api.acaoTarefaAgenda(tarefa.id, { acao: 'REABRIR', cicloChave: itens[0].cicloChave });
  await api.acaoTarefaAgenda(tarefa.id, { acao: 'EDITAR_SERIE', cicloChave: itens[0].cicloChave, alteracoes: { ajusteDiaUtil: 'MANTER', dataInicio: '2026-09-07', dataFim: '2026-09-07' } });
  itens = (await api.getTarefasAgenda('2026-10-01', '2026-10-31')).itens;
  expect(itens).toHaveLength(1);
  expect(itens[0].dataInicio).toBe('2026-10-07');
});

test('mock completo mantém ciclo fiscal nominal e IDs ao antecipar uma tarefa empresarial', async () => {
  const api = createMockApi(), companyId = (await api.listCompanies())[0].companyId;
  const config = { dataInicio: '2026-11-01', dataFim: '2026-11-01', recorrencia: 'MENSAL', ajusteDiaUtil: 'MANTER', repetirAte: '2026-12-01' };
  const { obrigacao } = await api.createObrigacao(companyId, { nome: 'Revisão', tipo: 'OBRIGACAO', periodicidade: 'MENSAL', diaVencimento: 20, ajusteDiaUtil: 'MANTER', defasagemMeses: 1, agendaConfig: config });
  const novembro = obrigacao.ocorrencias.find(o => o.cicloChave === '2026-11');
  const atualizado = await api.updateObrigacao(obrigacao.obrigacaoId, { agendaConfig: { ...config, ajusteDiaUtil: 'ANTECIPAR' } });
  const oc = atualizado.obrigacao.ocorrencias.find(o => o.cicloChave === '2026-11');
  expect(oc).toMatchObject({ ocorrenciaId: novembro.ocorrenciaId, dataInicio: '2026-10-30', dataVencimento: '2026-11-20', competenciaRef: '2026-10', agendaConfig: { dataInicioOriginal: '2026-11-01' } });
});

test.each(['agenda', 'legado'])('janela empresarial antecipa feriado e descarta metadados ao mudar a data via %s', async caminho => {
  const api = createMockApi(), companyId = (await api.listCompanies())[0].companyId;
  const { obrigacao } = await api.createObrigacao(companyId, { nome: 'Conferir NFS-e', tipo: 'TAREFA', periodicidade: 'MENSAL', agendaConfig: { dataInicio: '2026-10-09', dataFim: '2026-10-12', recorrencia: 'MENSAL', repetirAte: '2026-10-09', ajusteDiaUtil: 'ANTECIPAR', horaInicio: '09:00', horaFim: '10:00' } });
  const oc = obrigacao.ocorrencias[0];
  expect(oc.agendaConfig.diasAgendados.map(d => d.dataInicio)).toEqual(['2026-10-09', '2026-10-09', '2026-10-09', '2026-10-09']);
  await api.editarOcorrenciasAgenda([oc.ocorrenciaId], { horaInicio: '11:00', horaFim: '12:00', dataInicio: oc.dataInicio, dataFim: oc.dataFim });
  expect(oc.agendaConfig.diasAgendados).toHaveLength(4);
  expect(blocosDiarios(itensDasObrigacoes([obrigacao]), '2026-10-01', '2026-10-31')).toHaveLength(4);
  const patch = { dataInicio: '2026-10-13', dataFim: '2026-10-13' };
  if (caminho === 'legado') await api.updateOcorrencia(oc.ocorrenciaId, patch);
  else await api.editarOcorrenciasAgenda([oc.ocorrenciaId], patch);
  expect(oc.agendaConfig.diasAgendados).toBeUndefined();
  expect(oc.dataInicioOriginal).toBeUndefined();
  expect(blocosDiarios(itensDasObrigacoes([obrigacao]), '2026-10-01', '2026-10-31').map(b => b.dataInicio)).toEqual(['2026-10-13']);
});

test('avulsa antecipada continua visível e primeira recorrente passada é criada sem preencher todo o histórico', async () => {
  const api = createMockApi(), companyId = (await api.listCompanies())[0].companyId;
  const avulsa = await api.createObrigacao(companyId, { nome: 'Avulsa sábado', tipo: 'TAREFA', periodicidade: 'AVULSA', agendaConfig: { dataInicio: '2026-10-10', recorrencia: 'AVULSA', ajusteDiaUtil: 'ANTECIPAR' } });
  expect(avulsa.obrigacao.ocorrencias).toHaveLength(1);
  expect(avulsa.obrigacao.ocorrencias[0]).toMatchObject({ dataInicio: '2026-10-09', cicloChave: '2026-10-10' });
  const mensal = await api.createObrigacao(companyId, { nome: 'Primeira passada', tipo: 'TAREFA', periodicidade: 'MENSAL', agendaConfig: { dataInicio: '2026-07-12', recorrencia: 'MENSAL', ajusteDiaUtil: 'ANTECIPAR' } });
  expect(mensal.obrigacao.ocorrencias[0]).toMatchObject({ dataInicio: '2026-07-10', cicloChave: '2026-07' });
  expect(mensal.obrigacao.ocorrencias.some(oc => oc.cicloChave === '2026-08')).toBe(false);
});

test('obrigação diária sem prazo explícito conserva o vencimento nominal', async () => {
  const api = createMockApi(), companyId = (await api.listCompanies())[0].companyId;
  const { obrigacao } = await api.createObrigacao(companyId, { nome: 'Prazo diário', tipo: 'OBRIGACAO', periodicidade: 'DIARIA', agendaConfig: { dataInicio: '2026-10-12', recorrencia: 'DIARIA', repetirAte: '2026-10-12', ajusteDiaUtil: 'ANTECIPAR' } });
  expect(obrigacao.ocorrencias).toHaveLength(1);
  expect(obrigacao.ocorrencias[0]).toMatchObject({ dataInicio: '2026-10-09', dataVencimento: '2026-10-12' });
});

test('regra do escritório conserva ID e conclusão de cada empresa ao mudar a antecipação', async () => {
  const api = createMockApi(), companyId = (await api.listCompanies())[0].companyId;
  const agendaConfig = { dataInicio: '2026-10-12', dataFim: '2026-10-12', recorrencia: 'MENSAL', ajusteDiaUtil: 'MANTER', repetirAte: '2026-11-12' };
  const { regra } = await api.createRegraObrigacao({ nome: 'Revisão regra', tipo: 'OBRIGACAO', periodicidade: 'MENSAL', escopo: 'SELECAO_MANUAL', filtros: { empresasIds: [companyId] }, diaVencimento: 20, ajusteDiaUtil: 'MANTER', agendaConfig });
  const antes = (await api.listObrigacoes({ companyId })).obrigacoes.find(o => o.regraId === regra.regraId);
  const outubro = antes.ocorrencias.find(o => o.cicloChave === '2026-10');
  const novembro = antes.ocorrencias.find(o => o.cicloChave === '2026-11');
  await api.concluirOcorrencia(novembro.ocorrenciaId);
  await api.updateRegraObrigacao(regra.regraId, { agendaConfig: { ...agendaConfig, ajusteDiaUtil: 'ANTECIPAR' } });
  const depois = (await api.listObrigacoes({ companyId })).obrigacoes.find(o => o.regraId === regra.regraId);
  expect(depois.ocorrencias.find(o => o.cicloChave === '2026-10')).toMatchObject({ ocorrenciaId: outubro.ocorrenciaId, dataInicio: '2026-10-09' });
  expect(depois.ocorrencias.find(o => o.cicloChave === '2026-11')).toMatchObject({ ocorrenciaId: novembro.ocorrenciaId, status: 'CONCLUIDA' });
});
