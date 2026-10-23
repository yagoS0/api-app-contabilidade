import { criarGuruConferenciaApi } from '../real/guruConferenciaApi';
import { criarGuruConferenciaMock } from '../mock/guruConferenciaMock';
import { createRealApi } from '../real/realApi';
import { createMockApi } from '../mock/mockApi';

test('adaptador usa rotas reais, empresa escapada e revisão sem token Guru', async () => {
  const request = jest.fn(async () => ({ items: [], total: 0 }));
  const api = criarGuruConferenciaApi(request);
  await api.listarGuruConferencia('empresa/a', 2);
  expect(request).toHaveBeenLastCalledWith('/nfse/guru-conferencia/empresa%2Fa/preparacoes?pagina=2');
  const periodo = { campo: 'confirmed_at', inicio: '2026-10-01', fim: '2026-10-22' };
  await api.importarGuruConferencia('a', periodo);
  expect(request).toHaveBeenLastCalledWith('/nfse/guru-conferencia/a/importacoes', { method: 'POST', body: JSON.stringify(periodo) });
  await api.obterGuruConferencia('a', 'id');
  expect(request).toHaveBeenLastCalledWith('/nfse/guru-conferencia/a/preparacoes/id');
  const body = { versao: 2, hash: 'hash', confirmada: true };
  await api.conferirGuruConferencia('a', 'id', body);
  expect(request).toHaveBeenLastCalledWith('/nfse/guru-conferencia/a/preparacoes/id/conferir', { method: 'POST', body: JSON.stringify(body) });
});
test('real e mock expõem os mesmos métodos; mock informa desconexão e recusa escrita', async () => {
  const mock = criarGuruConferenciaMock();
  const real = createRealApi(), completo = createMockApi();
  for (const nome of Object.keys(mock)) { expect(typeof real[nome]).toBe('function'); expect(typeof completo[nome]).toBe('function'); }
  expect(await mock.listarGuruConferencia('a')).toMatchObject({ items: [], total: 0, conexao: 'DESCONECTADA', demonstracao: true });
  await expect(mock.importarGuruConferencia('a', {})).rejects.toMatchObject({ code: 'guru_desconectado' });
  await expect(mock.conferirGuruConferencia('a', 'id', {})).rejects.toMatchObject({ code: 'guru_desconectado' });
});
test('falha real não retorna sucesso mock', async () => {
  const api = criarGuruConferenciaApi(async () => { throw Object.assign(Error('recusado'), { status: 403 }); });
  await expect(api.importarGuruConferencia('a', {})).rejects.toMatchObject({ status: 403 });
});

test('busca fiscal local, filtro completo e download mantêm o contrato autenticado', async () => {
  const request = jest.fn(async () => ({})), api = criarGuruConferenciaApi(request);
  await api.buscarNotasGuru('a/b', 'Nota & tomador', 2);
  expect(request).toHaveBeenLastCalledWith('/nfse/guru-conferencia/a%2Fb/notas?busca=Nota+%26+tomador&pagina=2');
  await api.obterNotaGuru('a', 'portal:nota');
  expect(request).toHaveBeenLastCalledWith('/nfse/guru-conferencia/a/notas/portal%3Anota');
  await api.baixarNotaGuru('a', 'venda', 'portal:nota', 'xml');
  expect(request).toHaveBeenLastCalledWith('/nfse/guru-conferencia/a/preparacoes/venda/notas/portal%3Anota/xml', { responseType: 'blob' });
  const count = request.mock.calls.length;
  await expect(api.baixarNotaGuru('a', 'venda', 'nota', 'https://externo.invalid')).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(count);
  await api.listarGuruConferencia('a', 2, { campo: 'ordered_at', inicio: '2026-10-01', fim: '2026-10-22', estado: 'CONFLITO' });
  expect(request).toHaveBeenLastCalledWith('/nfse/guru-conferencia/a/preparacoes?pagina=2&campo=ordered_at&inicio=2026-10-01&fim=2026-10-22&estado=CONFLITO');
});
