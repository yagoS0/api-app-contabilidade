import { exigenciaIbscbs } from '../exigenciaIbscbs.js';
import { ibscbsDaDps } from '../ibscbsDaDps.js';
const dados = { opSimpNac:'1', cTribNac:'171901', categoria:'SERVICO_ISS' };
it('aplica a transição e distingue hipóteses de outubro e dezembro', () => {
  expect(exigenciaIbscbs({...dados,dataReferencia:'2026-09-30'}).obrigatorio).toBe(false);
  expect(exigenciaIbscbs({...dados,dataReferencia:'2026-10-01'}).obrigatorio).toBe(true);
  for (const cTribNac of ['010301','010501','010901','160101']) {
    expect(exigenciaIbscbs({...dados,cTribNac,dataReferencia:'2026-10-01'}).obrigatorio).toBe(false);
    expect(exigenciaIbscbs({...dados,cTribNac,dataReferencia:'2026-12-01'}).obrigatorio).toBe(true);
  }
  expect(exigenciaIbscbs({...dados,categoria:'PLATAFORMA',dataReferencia:'2026-10-01'}).obrigatorio).toBe(false);
  expect(exigenciaIbscbs({...dados,categoria:null,dataReferencia:'2026-10-01'}).revisao).toBe(true);
});
it('não infere opção do Simples e exige revisão em 2027', () => {
  expect(exigenciaIbscbs({...dados,opSimpNac:'3',dataReferencia:'2026-12-31'})).toMatchObject({obrigatorio:false,revisao:false});
  expect(exigenciaIbscbs({...dados,opSimpNac:'3',dataReferencia:'2027-01-01'}).revisao).toBe(true);
});
it('desligar integração ou limpar perfil não dispensa obrigação', () => {
  const contexto = { opSimpNac:'1',cTribNac:'171901',dataReferencia:'2026-12-01',perfil:null };
  expect(ibscbsDaDps({...contexto,ligado:false}).codigo).toBe('NFSE_IBSCBS_INTEGRACAO_DESLIGADA');
  expect(ibscbsDaDps({...contexto,ligado:true}).codigo).toBe('NFSE_IBSCBS_OBRIGATORIO');
});
