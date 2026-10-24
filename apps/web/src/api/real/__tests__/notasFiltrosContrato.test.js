import { createRealApi } from '../realApi';
test('lista e resumo serializam datas/situação e Ambas omite type, preservando empresa', async () => {
  const previous = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, notas: [], total: 0 }) }));
  try {
    const api = createRealApi();
    const filters = { papel: 'DEST', type: '', dataInicio: '2026-10-01', dataFim: '2026-10-23', situacao: 'cancelada', incluirCanceladas: '1', search: '12.345.678/0001-99' };
    await api.listNotas('a/b', filters); await api.getNotasSummary('a/b', filters);
    for (const [path] of global.fetch.mock.calls) {
      expect(path).toContain('/a%2Fb/notas');
      const params = new URL(path, 'http://localhost').searchParams;
      for (const key of ['papel', 'dataInicio', 'dataFim', 'situacao', 'incluirCanceladas', 'search']) expect(params.get(key)).toBe(filters[key]);
      expect(params.has('type')).toBe(false);
    }
  } finally { global.fetch = previous; }
});
