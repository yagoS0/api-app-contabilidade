import { fingerprintConfirmacaoEmissao as hash, exigirFingerprintConfirmado, CAMPOS_EMPRESA_CONFIRMACAO } from '../fingerprintConfirmacaoEmissao.js';

const base = { company: { id: 'a', cnpj: '39254243000191', codigoMunicipioIbge: '3304557', regimeHistorico: [{ regime: 'SIMPLES', vigenciaInicio: '2020-01-01' }] },
  perfil: { id: 'p', pAliq: '5', codigoServicoNacional: '171201' }, regime: 'SIMPLES', ambiente: 'homolog', perfisHabilitados: true, ibscbsLigado: false };
test.each(CAMPOS_EMPRESA_CONFIRMACAO)('alteração material de %s invalida resumo', campo => {
  expect(hash({ ...base, company: { ...base.company, [campo]: 'alterado' } })).not.toBe(hash(base));
});
test.each(['pAliq', 'regApTribSN', 'tribISSQN', 'cLocPrestacao', 'codigoServicoNacional', 'ativo', 'portalClientId'])('alteração de perfil %s invalida resumo', campo => {
  expect(hash({ ...base, perfil: { ...base.perfil, [campo]: 'alterado' } })).not.toBe(hash(base));
});
test('ordem das chaves, timestamps e numeração não mudam a aprovação', () => {
  expect(hash({ ...base, company: { ...base.company, rpsNumero: '999', updatedAt: new Date() }, perfil: { codigoServicoNacional: '171201', pAliq: '5', id: 'p', updatedAt: new Date() } })).toBe(hash(base));
});
test('falta, mudança ou ambiente diferente exige novo resumo', () => {
  for (const esperado of [null, 'velho', hash({ ...base, ambiente: 'producao' })]) expect(() => exigirFingerprintConfirmado(esperado, hash(base))).toThrow(/novo resumo/);
  expect(() => exigirFingerprintConfirmado(hash(base), hash(base))).not.toThrow();
});
