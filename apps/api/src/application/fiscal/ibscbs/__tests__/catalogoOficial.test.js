import { validarCodigosIbscbs, CATALOGO_IBSCBS } from '../catalogoOficial.js';
import { ibscbsDaDps, cstSugeridoPeloClassTrib } from '../../../nfse/ibscbsDaDps.js';
const valido = { cst: '000', cClassTrib: '000001', cIndOp: '100301', dataReferencia: '2026-09-28' };
it('confere códigos e correspondência na fonte oficial, inclusive vigência', () => {
  expect(validarCodigosIbscbs(valido)).toEqual([]);
  expect(validarCodigosIbscbs({ ...valido, cst: '999' }).map(e=>e.codigo)).toContain('NFSE_IBSCBS_CST_INVALIDO');
  expect(validarCodigosIbscbs({ ...valido, cst: '200' }).map(e=>e.codigo)).toContain('NFSE_IBSCBS_CST_DIVERGENTE');
  expect(validarCodigosIbscbs({ ...valido, cClassTrib: '999999' })[0].codigo).toBe('NFSE_IBSCBS_CLASSIFICACAO_INVALIDA');
  expect(validarCodigosIbscbs({ ...valido, dataReferencia: '2020-01-01' }).length).toBeGreaterThan(0);
  expect(CATALOGO_IBSCBS.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(validarCodigosIbscbs({...valido,dataReferencia:'2026-02-31'})[0].codigo).toBe('NFSE_IBSCBS_DATA_INVALIDA');
  expect(validarCodigosIbscbs({...valido,dataReferencia:new Date('inválida')})[0].codigo).toBe('NFSE_IBSCBS_DATA_INVALIDA');
});
it('não aceita classe exclusiva de outro documento nem indicador inexistente', () => {
  expect(validarCodigosIbscbs({ ...valido, cClassTrib:'000002' })[0].codigo).toBe('NFSE_IBSCBS_DOCUMENTO_INCOMPATIVEL');
  expect(validarCodigosIbscbs({ ...valido, cIndOp:'999999' })[0].codigo).toBe('NFSE_IBSCBS_OPERACAO_INVALIDA');
});
it('Anexo VIII não é veto a classificação válida na tabela própria', () => {
  const perfil = { ibscbsCst:'000', ibscbsCClassTrib:'000001', ibscbsCIndOp:'100301' };
  expect(ibscbsDaDps({ cTribNac:'171901',perfil,ligado:true,cNBS:'115021000',dataReferencia:'2026-09-28' })).toMatchObject({ok:true,informar:true});
  expect(ibscbsDaDps({ cTribNac:'171901',perfil,ligado:false,cNBS:'115021000' })).toMatchObject({ok:false,codigo:'NFSE_IBSCBS_INTEGRACAO_DESLIGADA'});
  expect(cstSugeridoPeloClassTrib('000001')).toMatchObject({ cst:'000', verificadoNaFonte:true });
  expect(cstSugeridoPeloClassTrib('999999')).toBeNull();
});
