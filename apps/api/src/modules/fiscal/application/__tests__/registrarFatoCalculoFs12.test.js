import { hashCalculo as hash } from '../../../../application/notas/apuracao/v2/CalculoConfirmado.js';
import { registrarFatoCalculoFs12 } from '../registrarFatoCalculoFs12.js';
function fixture() {
  const vinculo = { id: 'v', portalClientId: 'p', companyId: 'c', competencia: '2026-11', calculoId: 'calculo-1' };
  const entrada = { autorId: 'u', portalClientId: 'p', competencia: '2026-11', calculoId: 'calculo-1',
    tentativaId: 'attempt-1', tipo: 'TENTATIVA_INICIADA', chaveIdempotencia: 'command-1', evidenciaReferencia: 'evidence-1' };
  const evidence = { ...vinculo, tipo: entrada.tipo, tentativaId: entrada.tentativaId, referencia: 'evidence-1', origem: 'COORDENADOR_TESTE', proveniencia: 'RESERVA_LOCAL' };
  const rows = [];
  const p = { hash, autorizar: jest.fn(), lerContexto: jest.fn(async () => ({ empresaId: 'c' })),
    lerVinculo: jest.fn(async e => e.companyId === 'c' ? vinculo : null), lerEvidenciaFiscal: jest.fn(async () => evidence),
    lerTentativa: jest.fn(async e => rows.find(r => r.vinculoId === e.vinculoId && r.tentativaId === e.tentativaId && r.tipo === 'TENTATIVA_INICIADA')),
    lerFato: jest.fn(async e => rows.find(r => r.chaveIdempotencia === e.chaveIdempotencia)),
    inserirFato: jest.fn(async d => { rows.push(d); return d; }) };
  return { entrada, evidence, p, rows, deps: { transacionar: fn => fn(p) } };
}
test('fatos acrescentados com replay, sem estado ou efeito fiscal', async () => {
  const f = fixture();
  expect((await registrarFatoCalculoFs12(f.entrada, f.deps)).autorizaEfeitoFiscal).toBe(false);
  expect((await registrarFatoCalculoFs12(f.entrada, f.deps)).replay).toBe(true);
  Object.assign(f.evidence, { tipo: 'RESULTADO_CONFIRMADO', proveniencia: 'RESPOSTA_OFICIAL_CORRELACIONADA', numeroDeclaracao: 'D1' });
  await registrarFatoCalculoFs12({ ...f.entrada, tipo: f.evidence.tipo, chaveIdempotencia: 'command-2', numeroDeclaracao: 'FORGED' }, f.deps);
  expect(f.rows).toHaveLength(2); expect(f.rows[1].numeroDeclaracao).toBe('D1');
  expect(f.rows.every(r => !Object.hasOwn(r, 'status'))).toBe(true);
});
test.each(['ausente', 'INDICE', 'outraTentativa', 'outraEmpresa'])('evidência %s não comprova resultado', async caso => {
  const f = fixture(); await registrarFatoCalculoFs12(f.entrada, f.deps);
  Object.assign(f.evidence, { tipo: 'RESULTADO_CONFIRMADO', proveniencia: 'RESPOSTA_OFICIAL_CORRELACIONADA', numeroDeclaracao: 'D1' });
  if (caso === 'ausente') f.p.lerEvidenciaFiscal.mockResolvedValue(null);
  if (caso === 'INDICE') f.evidence.proveniencia = 'INDICE';
  if (caso === 'outraTentativa') f.evidence.tentativaId = 'wrong';
  if (caso === 'outraEmpresa') f.evidence.companyId = 'wrong';
  await expect(registrarFatoCalculoFs12({ ...f.entrada, tipo: 'RESULTADO_CONFIRMADO', chaveIdempotencia: 'next' }, f.deps)).rejects.toMatchObject({ code: 'FS12_FATO_SEM_EVIDENCIA' });
  expect(f.rows).toHaveLength(1);
});
test('resultado sem sua própria tentativa é recusado', async () => {
  const f = fixture(); f.evidence.tipo = 'RESULTADO_INCERTO';
  await expect(registrarFatoCalculoFs12({ ...f.entrada, tipo: f.evidence.tipo }, f.deps)).rejects.toMatchObject({ code: 'FS12_FATO_SEM_EVIDENCIA' });
  expect(f.rows).toHaveLength(0);
});
test('remapeamento de Company não permite acrescentar fato ao histórico anterior', async () => {
  const f = fixture(); f.p.lerContexto.mockResolvedValue({ empresaId: 'other' });
  await expect(registrarFatoCalculoFs12({ ...f.entrada, companyId: 'c' }, f.deps)).rejects.toMatchObject({ code: 'FS12_FATO_SEM_EVIDENCIA' });
  expect(f.p.lerEvidenciaFiscal).not.toHaveBeenCalled();
});
