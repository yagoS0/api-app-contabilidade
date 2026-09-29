import { normalizarAgenda, expandirAgenda, diasDaTarefa, ocorrenciasDaTarefa, encontrarOcorrenciaDaTarefa, prepararEdicaoSerieTarefa, ocorrenciasDoEstadoDaTarefa } from '../../../../../../packages/shared/src/agenda.js';

const tarefa = (config = {}) => ({ id: 't', titulo: 'Conferir notas', estados: {}, config: normalizarAgenda({ dataInicio: '2026-10-10', recorrencia: 'MENSAL', ajusteDiaUtil: 'ANTECIPAR', ...config }) });
const listar = (t, inicio = '2026-09-01', fim = '2027-03-31', feriado) => ocorrenciasDaTarefa(t, inicio, fim, feriado);

test('cadastros antigos mantêm datas e ajuste inválido é recusado', () => {
  expect(normalizarAgenda({ dataInicio: '2026-10-10' }).ajusteDiaUtil).toBe('MANTER');
  expect(() => normalizarAgenda({ dataInicio: '2026-10-10', ajusteDiaUtil: 'POSTERGAR' })).toThrow();
  expect(expandirAgenda({ dataInicio: '2026-10-10' }, '2026-10-01', '2026-10-31')[0].dataInicio).toBe('2026-10-10');
});

test('antecipa sábado/domingo mantendo dia nominal dos meses seguintes e chave do ciclo', () => {
  expect(listar(tarefa()).slice(0,3).map(i => [i.cicloChave, i.dataInicio, i.dataInicioOriginal])).toEqual([
    ['2026-10', '2026-10-09', '2026-10-10'], ['2026-11', '2026-11-10', '2026-11-10'], ['2026-12', '2026-12-10', '2026-12-10'],
  ]);
});

test('feriado cadastrado pode atravessar mês/ano e continua acessível pela chave nominal', () => {
  const t = tarefa({ dataInicio: '2027-01-02', repetirAte: '2027-01-02' });
  const feriado = d => d === '2027-01-01';
  const dezembro = listar(t, '2026-12-01', '2026-12-31', feriado);
  expect(dezembro).toHaveLength(1);
  expect(dezembro[0]).toMatchObject({ cicloChave: '2027-01', dataInicio: '2026-12-31' });
  expect(encontrarOcorrenciaDaTarefa(t, '2027-01', feriado)).toMatchObject({ dataInicio: '2026-12-31' });
  expect(listar(t, '2027-01-01', '2027-01-31', feriado)).toEqual([]);
});

test('conclusão, exclusão e movimentação individual preservam identidade nominal', () => {
  const t = tarefa();
  t.estados = { '2026-10': { concluidaEm: '2026-10-09' }, '2026-11': { canceladaEm: '2026-11-01' }, '2026-12': { alteracoes: { dataInicio: '2026-12-12', dataFim: '2026-12-12' } } };
  const itens = listar(t);
  expect(itens.find(i => i.cicloChave === '2026-10')).toMatchObject({ resolvido: true, dataInicio: '2026-10-09' });
  expect(itens.some(i => i.cicloChave === '2026-11')).toBe(false);
  expect(itens.find(i => i.cicloChave === '2026-12').dataInicio).toBe('2026-12-12');
  expect(ocorrenciasDoEstadoDaTarefa(t, '2026-11')[0].dataInicio).toBe('2026-11-10');
});

test('dias temporizados convergentes mantêm suas chaves e não ressuscitam dias cancelados', () => {
  const t = tarefa({ dataInicio: '2026-10-09', dataFim: '2026-10-12', horaInicio: '09:00', horaFim: '10:00', repetirAte: '2026-10-09' });
  t.estados = { '2026-10@2026-10-10': { canceladaEm: '2026-10-01' }, '2026-10@2026-10-11': { concluidaEm: '2026-10-09' } };
  const itens = listar(t);
  expect(itens.map(i => i.cicloChave)).toEqual(['2026-10@2026-10-09', '2026-10@2026-10-11', '2026-10@2026-10-12']);
  expect(itens.map(i => i.dataInicio)).toEqual(['2026-10-09', '2026-10-09', '2026-10-12']);
  expect(itens[1].resolvido).toBe(true);
  expect(new Set(itens.map(i => i.id)).size).toBe(itens.length);
  expect(itens.every(i => i.horaInicio === '09:00' && i.horaFim === '10:00')).toBe(true);
});

test('expansão pública conserva período nominal para divisão diária com feriados', () => {
  const t = tarefa({ dataInicio: '2026-10-09', dataFim: '2026-10-12', horaInicio: '09:00', horaFim: '10:00' });
  const feriado = d => d === '2026-10-12';
  const periodo = expandirAgenda(t.config, '2026-10-01', '2026-10-31', feriado)[0];
  expect(periodo).toMatchObject({ dataInicio: '2026-10-09', dataFim: '2026-10-09', dataFimOriginal: '2026-10-12' });
  const dias = diasDaTarefa(periodo, feriado);
  expect(dias).toHaveLength(4);
  expect(dias.every(d => d.dataInicio === '2026-10-09')).toBe(true);
  expect(dias.map(d => d.dataInicioOriginal)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
});

test('edição de horário na ocorrência antecipada conserva âncora e não duplica ciclos', () => {
  const t = tarefa();
  Object.assign(t, prepararEdicaoSerieTarefa(t, '2026-10', { titulo: 'Outra', dataInicio: '2026-10-09', dataFim: '2026-10-09', horaInicio: '09:00', horaFim: '10:00' }));
  const itens = listar(t);
  expect(itens.slice(0,3).map(i => i.dataInicio)).toEqual(['2026-10-09', '2026-11-10', '2026-12-10']);
  expect(itens.filter(i => i.dataInicio === '2026-10-09')).toHaveLength(1);
  expect(itens[0].titulo).toBe('Outra');
});

test('versão iniciada em janeiro pode ser exibida em dezembro sem reativar versão anterior', () => {
  const t = tarefa({ dataInicio: '2026-12-02' });
  const feriado = d => d === '2027-01-01';
  Object.assign(t, prepararEdicaoSerieTarefa(t, '2027-01', { titulo: 'Janeiro' }, feriado));
  const dezembro = listar(t, '2026-12-01', '2026-12-31', feriado);
  expect(dezembro.map(i => [i.cicloChave, i.dataInicio])).toEqual([['2026-12', '2026-12-02'], ['v1|2027-01', '2026-12-31']]);
});

test('dias semanais/diários antecipados também aparecem na consulta anterior', () => {
  for (const recorrencia of ['DIARIA', 'SEMANAL']) {
    const t = tarefa({ dataInicio: '2026-11-01', recorrencia, repetirAte: '2026-11-01' });
    expect(listar(t, '2026-10-30', '2026-10-30')).toHaveLength(1);
    expect(encontrarOcorrenciaDaTarefa(t, '2026-11-01').dataInicio).toBe('2026-10-30');
  }
});

test('histórico concluído não oculta outra data nominal que converge no mesmo dia útil', () => {
  const t = tarefa({ dataInicio: '2026-10-09', dataFim: '2026-10-11', horaInicio: '09:00', horaFim: '10:00', repetirAte: '2026-10-09' });
  t.estados['2026-10@2026-10-09'] = { concluidaEm: '2026-10-09' };
  Object.assign(t, prepararEdicaoSerieTarefa(t, '2026-10@2026-10-10', { titulo: 'Fim de semana', repetirAte: null }));
  const itens = listar(t, '2026-10-01', '2026-10-31');
  expect(itens.filter(i => i.dataInicio === '2026-10-09')).toHaveLength(2);
  expect(itens.find(i => i.cicloChave === '2026-10@2026-10-09').resolvido).toBe(true);
});

test.each(['TRIMESTRAL', 'SEMESTRAL', 'ANUAL'])('frequência %s mantém os meses e dia nominal', recorrencia => {
  const t = tarefa({ recorrencia });
  const itens = listar(t, '2026-10-01', '2027-11-01');
  expect(itens.length).toBeGreaterThan(1);
  expect(itens.every(i => i.dataInicioOriginal.endsWith('-10'))).toBe(true);
});
