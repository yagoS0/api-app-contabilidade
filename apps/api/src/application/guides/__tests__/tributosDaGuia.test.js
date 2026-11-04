import { resolverTributosDaGuia } from '../tributosDaGuia.js';
const doc = { id: 'g', portalClientId: 'c', competencia: '2026-10', tipo: 'OUTRA' };
test('OUTRA nunca inventa todos os impostos do Presumido', () => {
  expect(resolverTributosDaGuia({ ...doc, regime: 'LUCRO_PRESUMIDO' })).toMatchObject({ status: 'UNKNOWN', tributos: [] });
});
test('DARF misto preserva documento único, composição conhecida e entrada intacta', () => {
  const guide = { ...doc, extracted: { composicao: [{ codigo: '2089', tributo: 'IRPJ', total: 10 }, { codigo: '2372', tributo: 'CSLL', total: 20 }, { codigo: '1082-01', total: 5 }] } };
  const before = structuredClone(guide), r = resolverTributosDaGuia(guide);
  expect(r).toMatchObject({ guideId: 'g', status: 'IDENTIFIED', tributos: ['IRPJ', 'CSLL', 'INSS'] });
  expect(r.components).toHaveLength(3); expect(guide).toEqual(before);
  expect(r).not.toHaveProperty('capability'); expect(r).not.toHaveProperty('vencimento');
});
test.each([{ codigo: '9999', tributo: 'IRPJ' }, { codigo: 'texto2089' }, { codigo: '2089', tributo: 'CSLL' }, null])('linha desconhecida/conflitante permanece, sem aprovação parcial %j', item => {
  const r = resolverTributosDaGuia({ ...doc, extracted: { composicao: [{ codigo: '8109' }, item] } });
  expect(r.status).toBe('UNKNOWN'); expect(r.tributos).toContain('PIS'); expect(r.unknown).toHaveLength(1);
});
test('parcela Simples não é DAS mensal e mantém acordo/parcela', () => {
  expect(resolverTributosDaGuia({ ...doc, tipo: 'SIMPLES', parcelamentoId: 'p', numeroParcela: 3 })).toMatchObject({ status: 'IDENTIFIED', tributos: ['PARCELAMENTO'], parcelamentoId: 'p', numeroParcela: 3 });
});
test('parcela OUTRA vinculada usa identidade do acordo sem exigir composição ausente', () => {
  expect(resolverTributosDaGuia({ ...doc, parcelamentoId: 'acordo', numeroParcela: 4 })).toMatchObject({
    status: 'IDENTIFIED', tributos: ['PARCELAMENTO'], parcelamentoId: 'acordo', numeroParcela: 4, unknown: [],
  });
  expect(resolverTributosDaGuia({ ...doc, parcelamentoAvulso: true }).status).toBe('UNKNOWN');
  expect(resolverTributosDaGuia({ ...doc, parcelamentoId: 'acordo', extracted: { composicao: [{ codigo: '9999' }] } }).status).toBe('UNKNOWN');
});
test('tipo explícito sem composição é classificação, não prova de exigibilidade', () => {
  expect(resolverTributosDaGuia({ ...doc, tipo: 'ISS' })).toMatchObject({ status: 'IDENTIFIED', tributos: ['ISS'] });
  expect(resolverTributosDaGuia({ ...doc, tipo: 'INSS', extracted: { composicao: [{ codigo: '8109' }] } }).tributos).toEqual(['PIS']);
});
test('identidade ausente, composição inválida e parcelamento avulso não passam silenciosamente', () => {
  expect(resolverTributosDaGuia({ tipo: 'SIMPLES' }).status).toBe('UNKNOWN');
  expect(resolverTributosDaGuia({ ...doc, tipo: 'IRPJ', extracted: { composicao: {} } }).status).toBe('UNKNOWN');
  expect(resolverTributosDaGuia({ ...doc, tipo: 'SIMPLES', parcelamentoAvulso: true }).status).toBe('UNKNOWN');
});
