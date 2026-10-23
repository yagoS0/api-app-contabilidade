jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarGuruConferencia } from '../GuruConferenciaService.js';
import { periodo, transacao, pagina } from './fixtures/transacoesGuru.js';

function fixture() {
  let rows = new Map();
  const user = { id: 'contador', role: 'contador', status: 'active' };
  const appSetting = target => ({
    findUnique: async ({ where }) => target.get(where.key) || null,
    findMany: async ({ where, skip = 0, take = 1000 }) => [...target.values()].filter(r => r.key.startsWith(where.key.startsWith)).sort((a, b) => a.key.localeCompare(b.key)).slice(skip, skip + take),
    count: async ({ where }) => [...target.keys()].filter(k => k.startsWith(where.key.startsWith)).length,
    create: async ({ data }) => { if (target.has(data.key)) throw Error('duplicate'); target.set(data.key, structuredClone(data)); },
    update: async ({ where, data }) => { target.set(where.key, structuredClone({ key: where.key, ...data })); },
    upsert: async ({ where, create, update }) => { target.set(where.key, structuredClone(target.has(where.key) ? { key: where.key, ...update } : create)); },
  });
  const db = { user: { findUnique: async () => user }, company: { findUnique: async () => ({ id: 'empresa' }) },
    get appSetting() { return appSetting(rows); },
    $transaction: async fn => {
      const copy = new Map(structuredClone([...rows]));
      const result = await fn({ ...db, appSetting: appSetting(copy), $queryRaw: async () => [] });
      rows = copy; return result;
    } };
  const env = { NODE_ENV: 'test', GURU_CONFERENCIA_COMPANY_ID: 'empresa', GURU_CONFERENCIA_ACCOUNT_ID: 'conta',
    GURU_CONFERENCIA_IMPORT_ENABLED: 'true', GURU_CONFERENCIA_CREDENTIAL_SCOPE: 'EXCLUSIVE_PILOT', GURU_CONFERENCIA_USER_TOKEN: 'sintetico' };
  const http = { pagina: jest.fn(async () => pagina()) };
  const service = criarGuruConferencia({ db, env, http });
  const args = { companyId: 'empresa', userId: 'contador', body: periodo };
  return { db, user, env, http, service, args, rows: () => rows };
}

test('resumo usa todas as vendas filtradas, além da página, por moeda e sem converter ausência em zero', async () => {
  const f = fixture();
  const data = Array.from({ length: 25 }, (_, i) => transacao(`venda-${i}`, {
    dates: { confirmed_at: Date.parse('2026-10-10T12:00:00Z') / 1000 },
    payment: { total: i === 0 ? null : i === 1 ? 0 : 10, currency: i === 2 ? 'USD' : i === 3 ? null : 'BRL' },
  }));
  data.push(transacao('fora-periodo', { dates: { confirmed_at: Date.parse('2026-09-01T12:00:00Z') / 1000 } }));
  data.push(transacao('data-ausente', { dates: {} }));
  f.http.pagina.mockResolvedValue(pagina(data));
  await f.service.importar(f.args);
  const query = { campo: 'confirmed_at', inicio: '2026-10-01', fim: '2026-10-22' };
  const a = await f.service.listar({ ...f.args, query });
  const b = await f.service.listar({ ...f.args, query: { ...query, pagina: 2 } });
  expect(a.items).toHaveLength(20); expect(b.items).toHaveLength(5);
  expect(a.total).toBe(25); expect(b.resumo).toEqual(a.resumo);
  expect(a.resumo).toMatchObject({ vendas: 25, notasVinculadas: 0, vendasSemVinculo: 25, valoresAusentes: 1, moedasAusentes: 1,
    moedas: [{ moeda: 'BRL', total: '210', informados: 22, ausentes: 1 }, { moeda: 'USD', total: '10', informados: 1, ausentes: 0 }] });
  const item = a.items[0];
  await f.service.conferir({ ...f.args, id: item.id, body: { versao: item.versao, hash: item.hash, confirmada: true } });
  expect((await f.service.listar({ ...f.args, query: { ...query, estado: 'CONFERIDA' } })).total).toBe(1);
  await expect(f.service.listar({ ...f.args, query: { inicio: '2026-02-30', fim: '2026-03-01', campo: 'confirmed_at' } })).rejects.toMatchObject({ code: 'guru_periodo_invalido' });
  expect(f.http.pagina).toHaveBeenCalledTimes(1);
});

test('multipágina, replay, listagem total e isolamento por conta sem efeito fiscal', async () => {
  const f = fixture();
  f.http.pagina.mockResolvedValueOnce(pagina([transacao('a')], { hasMore: true, nextCursor: 'b', total: 2 }))
    .mockResolvedValueOnce(pagina([transacao('b')], { total: null }));
  expect(await f.service.importar(f.args)).toMatchObject({ estado: 'CONCLUIDA', lidas: 2, criadas: 2, paginas: 2 });
  expect(f.http.pagina.mock.calls[1][0]).toMatchObject({ cursor: 'b', periodo });
  f.http.pagina.mockResolvedValue(pagina([transacao('a'), transacao('b')]));
  expect(await f.service.importar(f.args)).toMatchObject({ criadas: 0, repetidas: 2 });
  const r = await f.service.listar(f.args);
  expect(r.total).toBe(2); expect(r.items).toHaveLength(2);
  expect(r.items[0]).toMatchObject({ emissaoBloqueada: true, situacaoFiscalExterna: 'NAO_VERIFICADA', baixaContabil: 'NAO_REALIZADA' });
  f.env.GURU_CONFERENCIA_ACCOUNT_ID = 'outra';
  expect((await f.service.listar(f.args)).total).toBe(0);
  await expect(f.service.obter({ ...f.args, id: r.items[0].id })).rejects.toMatchObject({ status: 404 });
});

test('divergência invalida conferência, mantém identidade/histórico e exige hash da nova evidência', async () => {
  const f = fixture(); await f.service.importar(f.args);
  const item = (await f.service.listar(f.args)).items[0];
  const comando = { ...f.args, id: item.id, body: { versao: item.versao, hash: item.hash, confirmada: true } };
  await f.service.conferir(comando);
  f.http.pagina.mockResolvedValue(pagina([transacao('venda-sintetica', { status: 'refunded' })]));
  expect(await f.service.importar(f.args)).toMatchObject({ conflitos: 1, criadas: 0 });
  let atual = (await f.service.listar(f.args)).items[0];
  expect(atual).toMatchObject({ id: item.id, estado: 'CONFLITO', versao: 3, conferencia: null });
  expect(atual.historico[2].anterior.conferencia).not.toBeNull();
  await expect(f.service.conferir(comando)).rejects.toMatchObject({ status: 409 });
  expect(await f.service.importar(f.args)).toMatchObject({ conflitos: 1 });
  expect((await f.service.obter(comando)).versao).toBe(3);
  const novo = await f.service.conferir({ ...comando, body: { versao: atual.versao, hash: atual.conflito.hash, confirmada: true } });
  expect(novo.item).toMatchObject({ estado: 'CONFERIDA', dados: { statusOriginal: 'refunded' }, versao: 4 });
});

test.each(['erro', 'repetida', 'limite', 'total'])('erro parcial %s não persiste registros nem total de sucesso', async tipo => {
  const f = fixture();
  f.http.pagina.mockResolvedValueOnce(pagina([transacao('a')], { hasMore: true, nextCursor: 'b', total: tipo === 'limite' ? 1001 : 2 }));
  if (tipo === 'erro') f.http.pagina.mockRejectedValueOnce(Object.assign(Error('segredo'), { code: 'guru_timeout', status: 502 }));
  if (tipo === 'repetida') f.http.pagina.mockResolvedValueOnce(pagina([transacao('a')]));
  if (tipo === 'total') f.http.pagina.mockResolvedValueOnce(pagina([]));
  await expect(f.service.importar(f.args)).rejects.toThrow();
  const r = await f.service.listar(f.args);
  expect(r.total).toBe(0); expect(r.ultimaImportacao).toMatchObject({ estado: 'FALHOU', gravadas: 0 });
  expect(JSON.stringify(r)).not.toContain('segredo');
});
test('revogação de acesso/configuração durante leitura impede persistência', async () => {
  for (const tipo of ['papel', 'config', 'acesso']) {
    const f = fixture();
    const revalidarAcesso = jest.fn(async () => {});
    f.http.pagina.mockImplementation(async () => {
      if (tipo === 'papel') f.user.role = 'client';
      if (tipo === 'config') f.env.GURU_CONFERENCIA_USER_TOKEN = 'trocado';
      if (tipo === 'acesso') revalidarAcesso.mockRejectedValue(Error('revogado'));
      return pagina();
    });
    await expect(f.service.importar({ ...f.args, revalidarAcesso })).rejects.toThrow();
    expect([...f.rows().keys()].filter(k => k.startsWith('guru-conferencia:'))).toHaveLength(0);
  }
});
test('produção sem opt-in e desconexão recusam sem HTTP; GET nunca consulta origem', async () => {
  const f = fixture(); await f.service.listar(f.args); expect(f.http.pagina).not.toHaveBeenCalled();
  f.env.NODE_ENV = 'production';
  await expect(f.service.importar(f.args)).rejects.toMatchObject({ status: 403 });
  f.env.NODE_ENV = 'test'; delete f.env.GURU_CONFERENCIA_USER_TOKEN;
  await expect(f.service.importar(f.args)).rejects.toMatchObject({ code: 'guru_desconectado' });
  expect(f.http.pagina).not.toHaveBeenCalled();
});

test('produção opt-in permite importação explícita e replay; leituras não chamam Guru nem expõem segredo', async () => {
  const f = fixture();
  f.env.GURU_CONFERENCIA_USER_TOKEN = 'segredo-unico-apenas-fixture';
  f.env.NODE_ENV = 'production'; f.env.GURU_CONFERENCIA_PRODUCTION_ENABLED = 'true';
  const lista = await f.service.listar(f.args);
  expect(lista.conexao).toBe('CONFIGURADA_NAO_VERIFICADA');
  expect(f.http.pagina).not.toHaveBeenCalled();
  expect(await f.service.importar(f.args)).toMatchObject({ criadas: 1 });
  expect(await f.service.importar(f.args)).toMatchObject({ criadas: 0, repetidas: 1 });
  const atual = await f.service.listar(f.args);
  await f.service.obter({ ...f.args, id: atual.items[0].id });
  expect(f.http.pagina).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(atual)).not.toContain(f.env.GURU_CONFERENCIA_USER_TOKEN);
  f.env.GURU_CONFERENCIA_CREDENTIAL_SCOPE = 'SHARED';
  await expect(f.service.importar(f.args)).rejects.toMatchObject({ code: 'guru_desconectado' });
  f.env.GURU_CONFERENCIA_CREDENTIAL_SCOPE = 'EXCLUSIVE_PILOT'; f.env.GURU_CONFERENCIA_IMPORT_ENABLED = 'false';
  await expect(f.service.importar(f.args)).rejects.toMatchObject({ code: 'guru_desconectado' });
  expect(f.http.pagina).toHaveBeenCalledTimes(2);
});

test.each(['production', 'development', 'test'])('alteração do opt-in durante leitura em %s impede persistência tardia', async ambiente => {
  const f = fixture();
  f.env.NODE_ENV = ambiente; f.env.GURU_CONFERENCIA_PRODUCTION_ENABLED = 'true';
  f.http.pagina.mockImplementationOnce(async () => {
    f.env.GURU_CONFERENCIA_PRODUCTION_ENABLED = 'false';
    return pagina();
  });
  await expect(f.service.importar(f.args)).rejects.toMatchObject({
    code: ambiente === 'production' ? 'guru_piloto_desabilitado' : 'guru_configuracao_alterada',
  });
  expect([...f.rows().keys()].filter(k => k.startsWith('guru-conferencia:'))).toHaveLength(0);
  expect([...f.rows().values()].every(r => r.value.estado === 'FALHOU' && r.value.gravadas === 0)).toBe(true);
  if (ambiente === 'production') {
    await expect(f.service.importar(f.args)).rejects.toMatchObject({ code: 'guru_piloto_desabilitado' });
    expect(f.http.pagina).toHaveBeenCalledTimes(1);
  }
  f.env.GURU_CONFERENCIA_PRODUCTION_ENABLED = 'true';
  expect(await f.service.importar(f.args)).toMatchObject({ criadas: 1 });
  expect(await f.service.importar(f.args)).toMatchObject({ criadas: 0, repetidas: 1 });
});
