import { validarCodigosRtc, TABELAS_RTC } from '../tabelasRtc.js';
import { cstSugeridoPeloClassTrib } from '../../../nfse/ibscbsDaDps.js';

const normal = { cIndOp: '100301', cst: '000', cClassTrib: '000001', competencia: '2026-10-05' };
it('aceita código nacional com zero inicial e não restringe pela correlação do serviço', () => {
  expect(validarCodigosRtc({ ...normal, cIndOp: '020301' })).toEqual([]);
});
it.each([
  [{ cIndOp: '999999' }, 'NFSE_IBSCBS_INDOP_INVALIDO'],
  [{ cst: '999' }, 'NFSE_IBSCBS_CST_INVALIDO'],
  [{ cClassTrib: '999999' }, 'NFSE_IBSCBS_CLASSIFICACAO_INVALIDA'],
  [{ cst: '200' }, 'NFSE_IBSCBS_CST_INCOMPATIVEL'],
  [{ cClassTrib: '000002' }, 'NFSE_IBSCBS_CLASSIFICACAO_NAO_NFSE'],
  [{ competencia: '2020-01-01' }, 'NFSE_IBSCBS_FORA_VIGENCIA'],
])('recusa domínio/compatibilidade/vigência inválidos: %j', (mudanca, codigo) => {
  expect(validarCodigosRtc({ ...normal, ...mudanca }).map(e => e.codigo)).toContain(codigo);
});
it('usa relação publicada para sugestão de CST e não inventa pelo prefixo', () => {
  expect(cstSugeridoPeloClassTrib('000001')).toMatchObject({ cst: '000', verificadoNaFonte: true });
  expect(cstSugeridoPeloClassTrib('999999')).toBeNull();
  expect(cstSugeridoPeloClassTrib('000002')).toBeNull();
});
it('tem fonte identificada e relações completas no snapshot', () => {
  expect(TABELAS_RTC.consultadoEm).toBe('2026-10-05');
  for (const c of TABELAS_RTC.classificacoes) {
    expect(TABELAS_RTC.csts.some(s => s.codigo === c.cst)).toBe(true);
    expect(typeof c.nfse).toBe('boolean');
  }
});
