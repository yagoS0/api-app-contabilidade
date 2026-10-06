import { snapshotFiscal } from '../snapshotFiscal.js';
import { CONTRATO_NACIONAL } from '../contratoNacional.js';

it('congela valores fiscais sem copiar certificado ou senha do cadastro', () => {
  const company = { codigoServicoNacional: '171901', certPassword: 'nao-copiar' };
  const perfil = { id: 'p1', ibscbsCst: '000', ibscbsCClassTrib: '000001', senha: 'nao-copiar' };
  const r = snapshotFiscal({ company, perfil, regime: 'SIMPLES', codigoServico: '171901', ibscbsLigado: true });
  perfil.ibscbsCst = '200';
  expect(r.contrato).toBe(CONTRATO_NACIONAL.id);
  expect(r.perfil.ibscbsCst).toBe('000');
  expect(JSON.stringify(r)).not.toContain('nao-copiar');
});
