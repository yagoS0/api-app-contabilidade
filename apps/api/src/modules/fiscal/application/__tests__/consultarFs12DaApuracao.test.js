import { consultarFs12DaApuracao } from '../consultarFs12DaApuracao.js';
test('consulta histórico escopado sem escrita e sem liberar cálculo', async () => {
  const entrada = { portalClientId: 'p', competencia: '2026-11', autorId: 'u' };
  const lerHistorico = jest.fn(async () => [{ id: 'r1', revisao: 1 }]);
  const autorizar = jest.fn();
  const result = await consultarFs12DaApuracao(entrada, { transacionar: fn => fn({ autorizar,
    lerContexto: async () => ({ empresaId: 'c', competenciaApuracao: '2026-11', inicioAtividade: '2026-11',
      regimeDoPeriodo: { empresaId: 'c', competencia: '2026-11', tipo: 'SIMPLES_NACIONAL', referencia: 'r1' } }),
    agora: () => '2026-11-16T12:00:00Z', hash: () => 'hash', lerHistorico }) });
  expect(autorizar).toHaveBeenCalledWith(entrada);
  expect(lerHistorico).toHaveBeenCalledWith({ ...entrada, companyId: 'c' });
  expect(result).toMatchObject({ revisaoVigente: 1, autorizaEfeitoFiscal: false, integracao: { permiteNovoCalculo: false } });
});
