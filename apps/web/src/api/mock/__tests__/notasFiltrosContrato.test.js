import { createMockApi } from '../mockApi';
const api = createMockApi({ delay: async () => {} });
test('total/resumo preservam além da página, canceladas e ambas as espécies', async () => {
  const filters = { incluirCanceladas: '1', limit: 1 };
  const list = await api.listNotas('filtros-A', filters), summary = await api.getNotasSummary('filtros-A', filters);
  expect(list.total).toBeGreaterThan(100); expect(list.notas).toHaveLength(1);
  expect(summary.lista.EMIT.count + summary.lista.DEST.count + summary.lista.OUTROS.count).toBe(list.total);
  const canceled = await api.listNotas('filtros-A', { situacao: 'cancelada' });
  expect(canceled.total).toBeGreaterThan(0);
  expect((await api.getNotasSummary('filtros-A', { situacao: 'cancelada' })).lista.EMIT.count).toBe(canceled.total);
});
test.each([{ dataInicio: '2026-02-30' }, { dataInicio: '2026-10-20', dataFim: '2026-10-01' }, { situacao: 'substituida' }])('rejeita filtro inválido %j nos dois contratos', async filters => {
  await expect(api.listNotas('A', filters)).rejects.toMatchObject({ status: 400 });
  await expect(api.getNotasSummary('A', filters)).rejects.toMatchObject({ status: 400 });
});
test('documento pontuado do tomador e datas filtram no mesmo universo', async () => {
  const all = await api.listNotas('A', { incluirCanceladas: '1', limit: 500 });
  const note = all.notas.find(n => n.tomadorDoc && n.tomadorDoc.replace(/\D/g, '').length === 14);
  expect(note).toBeDefined();
  const search = note.tomadorDoc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  const filters = { search, incluirCanceladas: '1', dataInicio: '2020-01-01', dataFim: '2030-12-31', limit: 500 };
  const list = await api.listNotas('A', filters), summary = await api.getNotasSummary('A', filters);
  expect(list.notas.some(n => n.id === note.id)).toBe(true);
  expect(summary.lista.EMIT.count + summary.lista.DEST.count + summary.lista.OUTROS.count).toBe(list.total);
  const empty = await api.listNotas('A', { dataInicio: '2090-01-01' }); expect(empty.total).toBe(0);
});
test('notas de A não abrem nem baixam em B; lista tem identidades independentes', async () => {
  const a = await api.listNotas('A', { limit: 1 }), b = await api.listNotas('B', { limit: 1 });
  expect(a.notas[0].id).not.toBe(b.notas[0].id);
  await expect(api.getNota('B', a.notas[0].id)).rejects.toMatchObject({ code: 'nota_nao_encontrada' });
  await expect(api.baixarNotasSelecionadas('B', [a.notas[0].id], 'XML')).rejects.toThrow('Nenhum arquivo');
});


test('ajuste local é isolado, não cancela recebida e não altera outra empresa', async () => {
  const a = await api.listNotas('ajuste-A', { papel: 'EMIT', situacao: 'autorizada' });
  const id = a.notas[0].id;
  await expect(api.marcarNotaStatus('ajuste-B', id, 'cancelada')).rejects.toMatchObject({ status: 404 });
  await api.marcarNotaStatus('ajuste-A', id, 'cancelada');
  expect((await api.getNota('ajuste-A', id)).nota.statusEfetivo).toBe('cancelada');
  const received = await api.listNotas('ajuste-A', { papel: 'DEST' });
  await expect(api.marcarNotaStatus('ajuste-A', received.notas[0].id, 'cancelada')).rejects.toMatchObject({ status: 409 });
});

test.each(['UTC', 'America/Sao_Paulo'])('XML, lista, detalhe e filtro preservam a data civil da nota 13111 em %s', async zone => {
  const old = process.env.TZ; process.env.TZ = zone;
  try {
    const all = await api.listNotas('data-' + zone, { incluirCanceladas: '1', limit: 500 });
    const note = all.notas.find(n => n.numero === '13111');
    expect(note).toBeDefined();
    const detail = (await api.getNota('data-' + zone, note.id)).nota;
    expect(note.issueDate).toContain('-28T00:00:00');
    expect(detail.dataEmissao).toEqual(note.dataEmissao);
    expect(detail.xml.conteudo).toContain(`<dhProc>${note.dataEmissao.evidencia.original}</dhProc>`);
    const filters = { dataInicio: note.dataEmissao.civil, dataFim: note.dataEmissao.civil, incluirCanceladas: '1', limit: 500 };
    const list = await api.listNotas('data-' + zone, filters);
    const summary = await api.getNotasSummary('data-' + zone, filters);
    expect(list.notas.some(n => n.id === note.id)).toBe(true);
    expect(summary.lista.EMIT.count + summary.lista.DEST.count + summary.lista.OUTROS.count).toBe(list.total);
    expect(list.datasIndeterminadas).toBeGreaterThan(0);
    expect(summary.datasIndeterminadas).toBe(list.datasIndeterminadas);
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
