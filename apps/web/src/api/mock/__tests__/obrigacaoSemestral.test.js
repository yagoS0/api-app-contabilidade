import { createMockApi } from '../mockApi';

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout'] });
  jest.setSystemTime(new Date('2027-08-01T12:00:00Z'));
});
afterEach(() => jest.useRealTimers());

test.each([false, true])('mock gera obrigação semestral com prazo fiscal, agenda configurada=%s', async configurada => {
  const api = createMockApi();
  const carteira = await api.listCompanies();
  const companyId = carteira[0].companyId;
  const dados = { nome: 'Revisão semestral', tipo: 'OBRIGACAO', periodicidade: 'SEMESTRAL', mesReferencia: 8, diaVencimento: 31, ajusteDiaUtil: 'MANTER' };
  if (configurada) dados.agendaConfig = { dataInicio: '2027-08-10', dataFim: '2027-08-15', recorrencia: 'SEMESTRAL', repetirAte: '2028-02-10' };
  const resultado = await api.createObrigacao(companyId, dados);
  expect(resultado.ok).toBe(true);
  const ocorrencias = resultado.obrigacao.ocorrencias;
  expect(ocorrencias.slice(0, 2).map(o => o.dataVencimento)).toEqual(['2027-08-31', '2028-02-29']);
  expect(ocorrencias.every(o => ['02', '08'].includes(o.dataVencimento.slice(5, 7)))).toBe(true);
  if (configurada) {
    expect(ocorrencias).toHaveLength(2);
    expect(ocorrencias[1]).toMatchObject({ dataInicio: '2028-02-10', dataFim: '2028-02-15' });
  }
});
