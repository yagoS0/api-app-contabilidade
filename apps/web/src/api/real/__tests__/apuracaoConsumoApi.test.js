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

 test('coleta CBS não envia competência nem janela às rotas de coleta', async () => {
  const request = jest.fn(async () => ({ ok: true })); const api = apuracaoConsumoApi(request);
  await api.getColetasCbs('a/b', { ambiente: 'PRODUCAO', competencia: '2026-10' });
  expect(request).toHaveBeenLastCalledWith('/firm/companies/a%2Fb/apuracao-consumo/cbs/coletas?ambiente=PRODUCAO');
  await api.abrirColetaCbs('a/b', { id: 'uuid', ambiente: 'HOMOLOGACAO', recurso: 'DEBITOS', competencia: '2026-10', inicio: '2026-10-01' });
  expect(request).toHaveBeenLastCalledWith('/firm/companies/a%2Fb/apuracao-consumo/cbs/coletas', { method: 'POST', body: JSON.stringify({ id: 'uuid', ambiente: 'HOMOLOGACAO', recurso: 'DEBITOS' }) });
  for (const [metodo, acao] of [['consultarColetaCbs', 'consultar'], ['baixarArquivoColetaCbs', 'baixar']]) {
    await api[metodo]('a/b', 'c/d', { id: 'intent', ambiente: 'HOMOLOGACAO', competencia: '2026-10' });
    expect(request).toHaveBeenLastCalledWith(`/firm/companies/a%2Fb/apuracao-consumo/cbs/coletas/c%2Fd/${acao}`, { method: 'POST', body: JSON.stringify({ id: 'intent', ambiente: 'HOMOLOGACAO' }) });
  }
});

test('mensal e inspeção local usam rotas contextuais com payload delimitado', async () => {
  const request = jest.fn(); const api = apuracaoConsumoApi(request), ctx = { tributo: 'IBS', ambiente: 'HOMOLOGACAO', competencia: '2026-10' };
  await api.getMensalConsumo('a/b', { ...ctx, ignorado: true }); await api.getHistoricoMensalConsumo('a/b', ctx);
  await api.registrarAcaoMensalConsumo('a/b', { ...ctx, id: 'uuid', versao: 2, acao: 'ALOCAR', dados: { valorCentavos: '100' }, ignorado: true });
  await api.reprocessarArquivoColetaCbs('a/b', 'x/y', { ambiente: 'HOMOLOGACAO', competencia: '2026-10' });
  expect(request.mock.calls[0][0]).toBe('/firm/companies/a%2Fb/apuracao-consumo/mensal?tributo=IBS&ambiente=HOMOLOGACAO&competencia=2026-10');
  expect(request.mock.calls[1][0]).toContain('/mensal/historico?');
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ ...ctx, id: 'uuid', versao: 2, acao: 'ALOCAR', dados: { valorCentavos: '100' } });
  expect(request.mock.calls[3]).toEqual(['/firm/companies/a%2Fb/apuracao-consumo/cbs/coletas/x%2Fy/reprocessar', { method: 'POST', body: JSON.stringify({ ambiente: 'HOMOLOGACAO' }) }]);
});
