import { apuracaoConsumoApi } from '../apuracaoConsumoApi';
test('leitura e escritas respeitam rotas, contexto e payloads sem transformar estados', async () => {
  const request = jest.fn(async () => ({ ok: true })); const api = apuracaoConsumoApi(request);
  const contexto = { tributo: 'CBS', ambiente: 'HOMOLOGACAO', competencia: '2027-01' };
  await api.getBaseApuracaoConsumo('a/b', contexto);
  expect(request).toHaveBeenLastCalledWith('/firm/companies/a%2Fb/apuracao-consumo?tributo=CBS&ambiente=HOMOLOGACAO&competencia=2027-01');
  for (const [metodo, rota, payload] of [
    ['vincularEstabelecimentosConsumo', 'estabelecimentos', { portalClientIds: ['a'] }],
    ['salvarConfiguracaoConsumo', 'configuracoes', { id: 'intencao', versao: 0, tributo: 'IBS', ambiente: 'PRODUCAO', habilitado: false, dados: { motivo: 'Conferir' } }],
    ['prepararRevisaoConsumo', 'revisoes', { id: 'intencao2', versao: 1, ...contexto, motivo: 'Preparar' }],
  ]) {
    await api[metodo]('a/b', payload);
    expect(request).toHaveBeenLastCalledWith(`/firm/companies/a%2Fb/apuracao-consumo/${rota}`, { method: 'POST', body: JSON.stringify(payload) });
  }
});
