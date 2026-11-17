import { createHash } from 'node:crypto';
import { confirmarFs12DaApuracao } from '../confirmarFs12DaApuracao.js';
const contexto = { empresaId: 'c', competenciaApuracao: '2026-11', inicioAtividade: '2026-11',
  regimeDoPeriodo: { empresaId: 'c', competencia: '2026-11', tipo: 'SIMPLES_NACIONAL', referencia: 'r1' } };
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const entrada = () => ({ portalClientId: 'p', competencia: '2026-11', autorId: 'u',
  serie: [{ mes: '2026-11', valorCentavos: 0 }], revisaoEsperada: 0,
  contextoRevisao: hash(contexto), chaveIdempotencia: 'command-0000000001' });
function preparar() {
  const rows = [];
  const portas = { hash, autorizar: jest.fn(), lerContexto: jest.fn(async () => contexto),
    lerComando: jest.fn(async e => rows.find(r => r.chaveIdempotencia === e.chaveIdempotencia)),
    lerUltima: jest.fn(async () => rows.at(-1)), inserir: jest.fn(async data => {
      const row = { ...data, id: `r${rows.length + 1}`, confirmadoEm: '2026-11-16T12:00:00Z' }; rows.push(row); return row;
    }) };
  return { portas, deps: { transacionar: fn => fn(portas) }, rows };
}
test('confirmação inicial, replay preserva autoria/instante e revalida autorização', async () => {
  const { portas, deps } = preparar();
  const first = await confirmarFs12DaApuracao(entrada(), deps);
  const replay = await confirmarFs12DaApuracao(entrada(), deps);
  expect(replay.confirmacao).toEqual(first.confirmacao); expect(replay.replay).toBe(true);
  expect(first.autorizaEfeitoFiscal).toBe(false); expect(portas.inserir).toHaveBeenCalledTimes(1);
  expect(portas.autorizar).toHaveBeenCalledTimes(2);
});
test('nova revisão preserva anterior e exige motivo', async () => {
  const { deps, rows } = preparar(); await confirmarFs12DaApuracao(entrada(), deps);
  const next = { ...entrada(), revisaoEsperada: 1, chaveIdempotencia: 'command-0000000002', serie: [{ mes: '2026-11', valorCentavos: 25 }] };
  await expect(confirmarFs12DaApuracao(next, deps)).rejects.toMatchObject({ status: 400 });
  await confirmarFs12DaApuracao({ ...next, motivo: 'Correção conferida' }, deps);
  expect(rows.map(r => r.serie[0].valorCentavos)).toEqual([0, 25]); expect(rows.map(r => r.revisao)).toEqual([1, 2]);
});
test('chave repetida com conteúdo diferente e revisão antiga conflitam', async () => {
  const { deps } = preparar(); await confirmarFs12DaApuracao(entrada(), deps);
  await expect(confirmarFs12DaApuracao({ ...entrada(), serie: [{ mes: '2026-11', valorCentavos: 1 }] }, deps)).rejects.toMatchObject({ code: 'FS12_IDEMPOTENCIA_CONFLITO' });
  await expect(confirmarFs12DaApuracao({ ...entrada(), chaveIdempotencia: 'command-0000000002' }, deps)).rejects.toMatchObject({ code: 'FS12_REVISAO_CONFLITO' });
});
test('contexto alterado, acesso revogado e falha de banco não confirmam', async () => {
  const { deps, portas } = preparar();
  await expect(confirmarFs12DaApuracao({ ...entrada(), contextoRevisao: 'a'.repeat(64) }, deps)).rejects.toMatchObject({ code: 'FS12_CONTEXTO_ALTERADO' });
  expect(portas.inserir).not.toHaveBeenCalled();
  portas.autorizar.mockRejectedValueOnce(Object.assign(Error('revogado'), { status: 403 }));
  await expect(confirmarFs12DaApuracao(entrada(), deps)).rejects.toMatchObject({ status: 403 });
  portas.inserir.mockRejectedValueOnce(Error('database'));
  await expect(confirmarFs12DaApuracao(entrada(), deps)).rejects.toThrow('database');
});
