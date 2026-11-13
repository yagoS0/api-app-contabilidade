import { diaFiscal, regimeDaCompetencia } from '../regimeDaCompetencia.js';
import { incidenciaMunicipal } from '../incidenciaMunicipal.js';
import { resolverContextoFiscalDaNota } from '../resolverContextoFiscalDaNota.js';
import { snapshotFiscal } from '../snapshotFiscal.js';
const historico = [
  { id: 'anterior', regime: 'SIMPLES', vigenciaInicio: '2025-01-01', vigenciaFim: '2025-12-31' },
  { id: 'atual', regime: 'LUCRO_PRESUMIDO', vigenciaInicio: '2026-01-01', vigenciaFim: null },
];
test.each([['2025-12-31','SIMPLES'],['2026-01-01','LUCRO_PRESUMIDO'],['2025-12','SIMPLES']])('regime por competência %s', (competencia, regime) => {
  expect(regimeDaCompetencia({ historico, competencia })).toMatchObject({ ok: true, regime, fonte: 'REGIME_HISTORICO' });
});

test.each(['2025-12-31T00:00:00.000Z', '2025-12-31T23:59:59.999Z', '2026-01-01T00:00:00.000Z'])('serialização JSON conserva o dia e o regime: %s', iso => {
  const competencia = new Date(iso);
  expect(regimeDaCompetencia({ historico, competencia: JSON.parse(JSON.stringify(competencia)) }))
    .toEqual(regimeDaCompetencia({ historico, competencia }));
});

test('aceitar ISO na competência não amplia o contrato público de diaFiscal', () => {
  const iso = '2025-12-31T00:00:00.000Z';
  expect(diaFiscal(iso)).toBeNull();
  expect(diaFiscal(new Date(iso))).toBe('2025-12-31');
  expect(diaFiscal('2025-12-31')).toBe('2025-12-31');
  expect(regimeDaCompetencia({ historico, competencia: iso })).toMatchObject({
    ok: true, competenciaInicio: '2025-12-31', competenciaFim: '2025-12-31',
  });
});

test.each(['vigenciaInicio', 'vigenciaFim'])('vigência %s continua recusando string ISO', campo => {
  const periodo = { ...historico[0], [campo]: campo === 'vigenciaInicio'
    ? '2025-01-01T00:00:00.000Z' : '2025-12-31T00:00:00.000Z' };
  expect(regimeDaCompetencia({ historico: [periodo], competencia: '2025-12-31T00:00:00.000Z' }))
    .toMatchObject({ ok: false, codigo: 'NFSE_REGIME_HISTORICO_INVALIDO' });
});

test.each([null, undefined, '', 202601, {}, [], new Date(NaN), '2026-00', '2026-13',
  '2026-02-29T00:00:00.000Z', '2026-02-30T00:00:00.000Z', '2026-01-01T24:00:00.000Z',
  '2026-01-01T00:60:00.000Z', '2026-01-01T00:00:00.000Zextra', '2026-01-01T00:00:00'])
('entrada inválida não vira competência: %s', competencia => {
  expect(regimeDaCompetencia({ historico, competencia }).codigo).toBe('NFSE_REGIME_COMPETENCIA_INVALIDA');
});
test.each([[[]], [[historico[1]]]])('não inventa passado sem cobertura', periodos => {
  expect(regimeDaCompetencia({ historico: periodos, competencia: '2025-12-01' }).codigo).toBe('NFSE_REGIME_SEM_VIGENCIA');
});
test('sobreposição e mudança dentro de mês pedem conferência', () => {
  expect(regimeDaCompetencia({ historico: [...historico, historico[0]], competencia: '2025-12-01' }).codigo).toBe('NFSE_REGIME_HISTORICO_AMBIGUO');
  const periodos = [{ ...historico[0], vigenciaFim: '2026-01-15' }, { ...historico[1], vigenciaInicio: '2026-01-16' }];
  expect(regimeDaCompetencia({ historico: periodos, competencia: '2026-01' }).ok).toBe(false);
  expect(regimeDaCompetencia({ historico: periodos, competencia: '2026-01-16' }).regime).toBe('LUCRO_PRESUMIDO');
});
test.each([
  ['2026-11-12', [], /12\/11\/2026.*vazio/],
  ['2026-11-12', [['2026-01-01','2026-10-31']], /já terminaram/],
  ['2026-11-12', [['2026-12-01',null]], /começam depois/],
  ['2026-11-12', [['2026-01-01','2026-11-11'], ['2026-11-13',null]], /entre vigências/],
  ['2026-11', [['2026-11-12',null]], /11\/2026.*parte do mês/],
])('explica falta de cobertura para %s, períodos %j', (competencia, datas, esperado) => {
  const periodos = datas.map(([vigenciaInicio,vigenciaFim]) => ({ regime: 'SIMPLES', vigenciaInicio, vigenciaFim }));
  expect(regimeDaCompetencia({ historico: periodos, competencia })).toMatchObject({
    ok: false, codigo: 'NFSE_REGIME_SEM_VIGENCIA', message: expect.stringMatching(esperado),
  });
});
test('não normaliza data impossível', () => {
  expect(regimeDaCompetencia({ historico, competencia: '2026-02-30' }).ok).toBe(false);
  expect(regimeDaCompetencia({ historico: [{ ...historico[0], vigenciaInicio: '2025-02-30' }], competencia: '2025-12-01' }).ok).toBe(false);
});
test.each(['030501','070201','141401','110401','120101','160201','171001','200101'])('exceção %s requer local informado na operação', codigoServico => {
  const base = { codigoServico, company: { codigoMunicipioIbge: '3304557' }, local: { codigo: '3550308', fonte: 'PERFIL' } };
  expect(incidenciaMunicipal(base).ok).toBe(false);
  expect(incidenciaMunicipal({ ...base, servico: { cLocPrestacao: '3550308' }, local: { codigo: '3550308', fonte: 'OPERACAO' } })).toMatchObject({ ok: true, municipio: '3550308', estado: 'EXCECAO_LOCAL_INFORMADO' });
});
test.each(['030401','220101','110201','170501','042201','150101'])('contexto específico %s não é inferido', codigoServico => {
  expect(incidenciaMunicipal({ codigoServico }).codigo).toBe('NFSE_INCIDENCIA_MUNICIPAL_PENDENTE');
});
test('local físico diferente não desloca automaticamente ISS de serviço geral', () => {
  expect(incidenciaMunicipal({ codigoServico: '171901', company: { codigoMunicipioIbge: '3304557' }, servico: { cLocPrestacao: '3550308' }, local: { codigo: '3550308', fonte: 'OPERACAO' } })).toMatchObject({ municipio: '3304557', validacaoMunicipalCompleta: false });
});
test('14.14 anterior à LC 218 exige revisão histórica', () => {
  expect(incidenciaMunicipal({ codigoServico: '141401', competencia: '2025-09-24', servico: { cLocPrestacao: '3550308' }, local: { codigo: '3550308', fonte: 'OPERACAO' } }).ok).toBe(false);
});
test('núcleo comum aplica a trava e snapshot conserva vigência', () => {
  expect(resolverContextoFiscalDaNota({ company: {}, codigoServico: '070201', regime: 'SIMPLES', competencia: '2026-01-01' }).codigo).toBe('NFSE_INCIDENCIA_MUNICIPAL_PENDENTE');
  const regimeVigente = regimeDaCompetencia({ historico, competencia: '2025-12-01' });
  const snap = snapshotFiscal({ regime: regimeVigente.regime, regimeVigente });
  regimeVigente.regime = 'LUCRO_REAL';
  expect(snap.regimeVigente.regime).toBe('SIMPLES');
});
