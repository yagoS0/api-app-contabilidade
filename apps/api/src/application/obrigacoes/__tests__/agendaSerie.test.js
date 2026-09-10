import { aplicarJanela, normalizarJanela, janelaDoCiclo, cicloDaOcorrencia, cicloPermitido, regraDoCiclo, normalizarRegraRecorrente } from '../agendaSerie.js';
import { sincronizarAgenda } from '../sincronizarAgenda.js';
const date = s => new Date(`${s}T00:00:00Z`);
const janela = { modo: 'DIAS_DO_CICLO', diaInicio: 10, diaFim: 15, deslocamentoFim: 0 };
test('janela 10–15 não segue o prazo ajustado para dia 21', () => {
  const p = aplicarJanela({ mesVencimento: '2026-09', data: date('2026-09-21') }, janela);
  expect(p.dataInicio).toEqual(date('2026-09-10')); expect(p.dataFim).toEqual(date('2026-09-15'));
  expect(p.data).toEqual(date('2026-09-21'));
});
test('fim no mês seguinte e dias inexistentes são datas civis válidas', () => {
  const p = aplicarJanela({ mesVencimento: '2028-02' }, { ...janela, diaInicio: 31, diaFim: 5, deslocamentoFim: 1 });
  expect(p.dataInicio).toEqual(date('2028-02-29')); expect(p.dataFim).toEqual(date('2028-03-05'));
});
test('recusa janela invertida sem deslocamento explícito', () => {
  expect(() => normalizarJanela({ ...janela, diaInicio: 28, diaFim: 5 })).toThrow();
});
test('versão futura não altera o mês anterior e corte não depende do vencimento', () => {
  const serie = { janelaTrabalho: janela, agendaVersoes: [{ aPartirDe: '2026-10', janela: { ...janela, diaFim: 17 } }], encerradaAPartirDe: '2026-12' };
  expect(janelaDoCiclo(serie, '2026-09').diaFim).toBe(15);
  expect(janelaDoCiclo(serie, '2026-10').diaFim).toBe(17);
  expect(cicloPermitido(serie, '2026-12')).toBe(false);
  expect(cicloDaOcorrencia({ competenciaRef: '2026-08', dataVencimento: date('2026-10-01') }, { defasagemMeses: 1 })).toBe('2026-09');
});
test('geração repetida não ressuscita cancelada, concluída ou exceção, nem gera após corte', async () => {
  const rows = [
    { id: 'set', cicloChave: '2026-09', canceladaEm: date('2026-09-01'), status: 'PENDENTE' },
    { id: 'out', cicloChave: '2026-10', status: 'CONCLUIDA' },
    { id: 'nov', cicloChave: '2026-11', status: 'PENDENTE', janelaPersonalizada: true },
  ];
  const db = { ocorrenciaObrigacao: { findMany: async () => rows, update: jest.fn(), createMany: jest.fn() } };
  const serie = { id: 's1', periodicidade: 'MENSAL', diaVencimento: 20, ajusteDiaUtil: 'MANTER', defasagemMeses: 1, janelaTrabalho: janela, encerradaAPartirDe: '2026-12' };
  await sincronizarAgenda(db, serie, { hoje: date('2026-09-01'), ehFeriado: () => false });
  await sincronizarAgenda(db, serie, { hoje: date('2026-09-01'), ehFeriado: () => false });
  expect(db.ocorrenciaObrigacao.createMany).not.toHaveBeenCalled();
  expect(db.ocorrenciaObrigacao.update).not.toHaveBeenCalled();
});


test('mensal para trimestral e de volta preserva IDs, passado, concluídas, exceções e canceladas', async () => {
  const rows = [];
  const db = { ocorrenciaObrigacao: {
    findMany: async () => rows,
    update: async ({ where, data }) => Object.assign(rows.find(o => o.id === where.id), data),
    createMany: async ({ data }) => { rows.push(...data.map((o, i) => ({ ...o, id: 'id-' + (rows.length + i) }))); return { count: data.length }; },
  } };
  const serie = { id: 's', periodicidade: 'MENSAL', diaVencimento: 20, ajusteDiaUtil: 'MANTER', defasagemMeses: 1, janelaTrabalho: janela, agendaVersoes: [] };
  const sync = () => sincronizarAgenda(db, serie, { hoje: date('2026-09-01'), ehFeriado: () => false, incluirVencidoDoMes: true });
  await sync();
  const por = ciclo => rows.find(o => o.cicloChave === ciclo);
  por('2026-11').status = 'CONCLUIDA';
  por('2026-12').janelaPersonalizada = true;
  por('2027-02').canceladaEm = date('2026-09-01');
  const preservadas = ['2026-09', '2026-11', '2026-12', '2027-02'].map(c => ({ ...por(c) }));
  const idMaio = por('2027-05').id;
  const trimestral = normalizarRegraRecorrente({ periodicidade: 'TRIMESTRAL', mesReferencia: 10, diaVencimento: 25 }, serie);
  serie.agendaVersoes.push({ aPartirDe: '2026-10', janela, regra: trimestral });
  await sync();
  expect(por('2027-05').foraDaRecorrencia).toBe(true);
  expect(por('2026-10').dataVencimento).toEqual(date('2026-10-25'));
  for (const p of preservadas) expect(por(p.cicloChave)).toEqual(p);
  serie.agendaVersoes.push({ aPartirDe: '2026-10', janela: null, regra: { ...trimestral, periodicidade: 'MENSAL', diasPreparacao: 4 } });
  await sync(); await sync();
  expect(por('2027-05')).toMatchObject({ id: idMaio, foraDaRecorrencia: false, dataInicio: date('2027-05-21'), dataVencimento: date('2027-05-25') });
  for (const p of preservadas) expect(por(p.cicloChave)).toEqual(p);
  expect(new Set(rows.map(o => o.cicloChave)).size).toBe(rows.length);
});

test('último snapshot aplicável vence mesmo havendo agendamento posterior antigo', () => {
  const serie = { periodicidade: 'MENSAL', agendaVersoes: [
    { aPartirDe: '2027-01', regra: { periodicidade: 'ANUAL' } },
    { aPartirDe: '2026-10', regra: { periodicidade: 'TRIMESTRAL' } },
  ] };
  expect(regraDoCiclo(serie, '2026-09').periodicidade).toBe('MENSAL');
  expect(regraDoCiclo(serie, '2027-01').periodicidade).toBe('TRIMESTRAL');
});

test.each([{ periodicidade: 'AVULSA' }, { periodicidade: 'ANUAL', mesReferencia: 0 }, { diaVencimento: 32 }, { defasagemMeses: -1 }, { ajusteDiaUtil: 'QUALQUER' }])('recusa configuração futura inválida %j', patch => {
  expect(() => normalizarRegraRecorrente(patch, { periodicidade: 'MENSAL', diaVencimento: 20, ajusteDiaUtil: 'MANTER' })).toThrow();
});
