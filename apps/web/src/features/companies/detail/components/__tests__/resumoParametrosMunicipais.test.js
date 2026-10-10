import { resumoParametrosMunicipais } from '../resumoParametrosMunicipais';
const base = { recurso: 'servico', status: 'RECEBIDO_PARA_CONFERENCIA', codigoServico: '170601001' };
const registro = (lista) => ({ ...base, resposta: { aliquotas: { '17.06.01.001': lista } } });
test('preserva alíquota zero e identifica vigência mensal parcial', () => {
  const [r] = resumoParametrosMunicipais(registro([{ Aliq: 0, Incidencia: 'SIM', DtIni: '2026-01-16T00:00:00', DtFim: null }]), '2026-01');
  expect(r.aliquota).toBe(0);
  expect(r.situacao).toMatch(/apenas parte/);
});
test.each([['2026-01-15', /fora/], ['2026-01-16', /cobre a competência/], ['2026-01-31', /cobre a competência/], ['2026-02-01', /fora/]])('compara limites em %s', (competencia, situacao) => {
  expect(resumoParametrosMunicipais(registro([{ DtIni: '2026-01-16T00:00:00', DtFim: '2026-01-31T00:00:00', Aliq: 5 }]), competencia)[0].situacao).toMatch(situacao);
});
test('JSON desconhecido, data impossível e código divergente não viram validação', () => {
  expect(resumoParametrosMunicipais({ ...base, resposta: {} }, '2026-01')).toEqual([]);
  expect(resumoParametrosMunicipais(registro([{ DtIni: '2026-02-30' }]), '2026-01')[0].situacao).toMatch(/não interpretável/);
  expect(resumoParametrosMunicipais({ ...registro([{ DtIni: '2026-01-01' }]), codigoServico: '170601002' }, '2026-01')[0].situacao).toMatch(/diferente/);
});
