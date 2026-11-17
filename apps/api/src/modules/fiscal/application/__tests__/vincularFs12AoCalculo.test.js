import { hashCalculo } from '../../../../application/notas/apuracao/v2/CalculoConfirmado.js';
import { prepararFs12ParaNovoCalculo, vincularFs12AoCalculo, consultarVinculoFs12DoCalculo, validarUsoFs12DoCalculo } from '../vincularFs12AoCalculo.js';
const hash = hashCalculo;
const contexto = { empresaId: 'c', competenciaApuracao: '2026-11', inicioAtividade: '2026-11',
  regimeDoPeriodo: { empresaId: 'c', competencia: '2026-11', tipo: 'SIMPLES_NACIONAL', referencia: 'r1' } };
function fixture() {
  const serie = [{ mes: '2026-11', valorCentavos: 0 }];
  const revisao = { id: 'r1', revisao: 1, serie, serieHash: hash(serie), contextoRevisao: hash(contexto), politicaVersao: 'PGDAS-2026-B1.v1' };
  const calculo = { calculoId: 'calculo-1', portalClientId: 'p', competencia: '2026-11',
    fs12: { revisaoId: 'r1', revisao: 1, contextoHash: hash(contexto), politicaVersao: revisao.politicaVersao }, formulario: { folhaMensal12: [0] } };
  const rows = [];
  const p = { hash, autorizar: jest.fn(), lerContexto: jest.fn(async () => contexto), lerUltima: jest.fn(async () => revisao),
    lerCalculoConfirmado: jest.fn(async () => calculo),
    lerVinculo: jest.fn(async e => rows.find(r => r.calculoId === e.calculoId && r.portalClientId === e.portalClientId && r.companyId === e.companyId && r.competencia === e.competencia) || null),
    inserirVinculo: jest.fn(async d => { const r = { id: 'v1', ...d }; rows.push(r); return r; }) };
  const deps = { transacionar: fn => fn(p) };
  const entrada = { autorId: 'u', portalClientId: 'p', competencia: '2026-11', calculoId: 'calculo-1', revisaoEsperada: 1, contextoHash: hash(contexto) };
  return { p, deps, entrada, rows, calculo, revisao };
}
test('preparo somente leitura e vínculo/replay exatos nunca autorizam efeito fiscal', async () => {
  const f = fixture();
  expect(await prepararFs12ParaNovoCalculo(f.entrada, f.deps)).toMatchObject({ revisaoFs12: 1, autorizaEfeitoFiscal: false, serie: [{ mes: '2026-11', valorCentavos: 0 }] });
  expect(f.p.inserirVinculo).not.toHaveBeenCalled();
  const first = await vincularFs12AoCalculo(f.entrada, f.deps);
  const replay = await vincularFs12AoCalculo(f.entrada, f.deps);
  expect(first.vinculo.calculoConfirmado).toEqual(f.calculo);
  expect(first.autorizaEfeitoFiscal).toBe(false); expect(replay.replay).toBe(true);
  expect(f.p.inserirVinculo).toHaveBeenCalledTimes(1); expect(f.p.autorizar).toHaveBeenCalledTimes(3);
});
test('hash fornecido e envelope forjado não substituem snapshot validado pelo servidor', async () => {
  const f = fixture();
  f.p.lerCalculoConfirmado.mockRejectedValueOnce(Object.assign(Error('obsolete'), { code: 'CALCULO_DESATUALIZADO' }));
  await expect(vincularFs12AoCalculo({ ...f.entrada, calculoConfirmado: f.calculo, calculoHash: hash(f.calculo) }, f.deps)).rejects.toMatchObject({ code: 'CALCULO_DESATUALIZADO' });
  expect(f.p.inserirVinculo).not.toHaveBeenCalled();
});
test.each(['ausente', 'revisaoId', 'revisao', 'contextoHash', 'politicaVersao'])('referência %s incompatível recusa captura, sem backfill', async campo => {
  const f = fixture();
  if (campo === 'ausente') delete f.calculo.fs12; else f.calculo.fs12[campo] = 'wrong';
  await expect(vincularFs12AoCalculo(f.entrada, f.deps)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
  expect(f.p.inserirVinculo).not.toHaveBeenCalled();
});
test('histórico permanece após recálculo; validação de uso exige snapshot vigente', async () => {
  const f = fixture(); await vincularFs12AoCalculo(f.entrada, f.deps);
  f.p.lerCalculoConfirmado.mockRejectedValue(Error('snapshot substituído'));
  expect((await consultarVinculoFs12DoCalculo(f.entrada, f.deps)).id).toBe('v1');
  await expect(validarUsoFs12DoCalculo(f.entrada, f.deps)).rejects.toThrow('snapshot substituído');
});
test('substituição da FS12 invalida uso, sem apagar histórico ou produzir cálculo', async () => {
  const f = fixture(); await vincularFs12AoCalculo(f.entrada, f.deps);
  expect((await validarUsoFs12DoCalculo(f.entrada, f.deps)).autorizaEfeitoFiscal).toBe(false);
  f.revisao.revisao = 2;
  await expect(validarUsoFs12DoCalculo(f.entrada, f.deps)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
  expect((await consultarVinculoFs12DoCalculo(f.entrada, f.deps)).revisaoFs12).toBe(1);
});
test('Company é resolvida no servidor também no histórico, ignorando corpo forjado', async () => {
  const f = fixture(); await vincularFs12AoCalculo(f.entrada, f.deps);
  f.p.lerContexto.mockResolvedValue({ ...contexto, empresaId: 'other' });
  expect(await consultarVinculoFs12DoCalculo({ ...f.entrada, companyId: 'c' }, f.deps)).toBeNull();
});
test('revogação impede replay/leitura, e contexto alterado impede gravação', async () => {
  const f = fixture();
  f.p.lerContexto.mockResolvedValueOnce({ ...contexto, cadastro: 'changed' });
  await expect(vincularFs12AoCalculo(f.entrada, f.deps)).rejects.toMatchObject({ code: 'FS12_CALCULO_CONFLITO' });
  f.p.autorizar.mockRejectedValue(Error('revogado'));
  await expect(consultarVinculoFs12DoCalculo(f.entrada, f.deps)).rejects.toThrow('revogado');
  expect(f.rows).toHaveLength(0);
});
