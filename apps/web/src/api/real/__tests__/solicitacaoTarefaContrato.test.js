import { createRealApi } from '../realApi';

test('conversion and ID lookup preserve original version, explicit null and encoded identities', async () => {
  const previous = global.fetch;
  global.fetch = jest.fn(async url => ({ ok: true, status: 200, json: async () => url.includes('/solicitacoes/')
    ? { ok: true, item: { id: 's', tarefa: { id: 't', podeAbrir: true } } }
    : { ok: true, tarefa: { id: 't', responsavelId: null } } }));
  try {
    const api = createRealApi();
    const body = { chave: 'k', versao: 'a'.repeat(64), dados: { titulo: 'Trabalho', responsavelId: null, empresasIds: [], config: { dataInicio: '2026-10-27' } } };
    expect(await api.converterSolicitacaoEmTarefa('s/a', body)).toEqual({ ok: true, item: { id: 's', tarefa: { id: 't', podeAbrir: true } } });
    expect(global.fetch.mock.calls[0][0]).toContain('/firm/solicitacoes/s%2Fa/tarefa');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(body);
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
    expect(await api.obterTarefaCalendario('t/a', { cicloChave: '2026-10' })).toEqual({ ok: true, tarefa: { id: 't', responsavelId: null } });
    expect(global.fetch.mock.calls[1][0]).toContain('/firm/agenda/unificada/t%2Fa?cicloChave=2026-10');
    await api.obterTarefaCalendario('t/a');
    expect(global.fetch.mock.calls[2][0]).toMatch(/\/firm\/agenda\/unificada\/t%2Fa$/);
  } finally { global.fetch = previous; }
});
