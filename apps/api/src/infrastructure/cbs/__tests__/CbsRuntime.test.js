import { criarCompositorCbs, criarRuntimeCbsDoAmbiente } from '../CbsRuntime.js';
import { carregarGrupo, ultimaConfiguracao } from '../../../application/fiscal/consumo/ApuracaoConsumoService.js';
jest.mock('../../../application/fiscal/consumo/ApuracaoConsumoService.js', () => ({ carregarGrupo: jest.fn(), ultimaConfiguracao: jest.fn(), transacao: (db, f) => db.$transaction(f) }));
const updatedAt = new Date('2026-10-12T12:00:00Z');
const permissao = { habilitado: true, contribuinteId: 'grupo', ambiente: 'HOMOLOGACAO', configuracaoId: 'cfg', credencialId: 'cred', credencialPortalClientId: 'empresa', credencialAtualizadaEm: updatedAt.toISOString(), matrizConfirmada: true, referenciaHomologacao: 'evidência', referenciaContrato: 'contrato', referenciaCallback: 'registro', urlRetorno: 'https://callback.example/cbs/opaque', hostsDownloadPermitidos: ['download.example'] };
const req = { companyId: 'empresa', ambiente: 'HOMOLOGACAO', usuario: { id: 'operador' } };
let db, decrypt, fetchImpl, resolver;
beforeEach(() => {
  carregarGrupo.mockResolvedValue({ id: 'grupo', estabelecimentos: [{ id: 'empresa' }] });
  ultimaConfiguracao.mockResolvedValue({ id: 'cfg', habilitado: true, dados: { credencialId: 'cred', credencialPortalClientId: 'empresa' } });
  db = { companyCredential: { findFirst: jest.fn(async ({ select }) => ({ id: 'cred', updatedAt, ...(select.login ? { login: 'clientid', senhaCifrada: 'cifrado' } : {}) })) }, companyCredentialAcesso: { create: jest.fn(async () => ({})) },
    $queryRaw: jest.fn(async strings => strings.join('').includes('clock_timestamp') ? [{ agora: new Date() }] : []), apuracaoCbsTokenEmissao: { count: jest.fn(async () => 0), create: jest.fn(async () => ({})) } };
  db.$transaction = async f => f(db);
  decrypt = jest.fn(async () => 'segredo'); fetchImpl = jest.fn(async url => new Response(JSON.stringify(url.endsWith('/token') ? { access_token: 'token', token_type: 'bearer', expires_in: 3600 } : { estado: 'PENDENTE' })));
  resolver = extras => criarCompositorCbs({ db, autorizacoes: [permissao], protecao: { cifrar() {}, decifrar() {} }, decifrarCredencial: decrypt, fetchImpl, ...extras });
});
test('OFF por padrão e matriz/ambiente/grupo/contrato restritos', async () => {
  expect((await resolver({ autorizacoes: [] })(req)).cliente).toBeUndefined();
  for (const patch of [{ matrizConfirmada: false },{ referenciaHomologacao: '' },{ ambiente: 'PRODUCAO' },{ contribuinteId: 'outro' },{ habilitado: false },{ hostsDownloadPermitidos: [] }]) expect((await resolver({ autorizacoes: [{ ...permissao, ...patch }] })(req)).cliente).toBeUndefined();
  expect(fetchImpl).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled();
});
test('resolver só lê metadados; segredo só sob ação e auditoria antes decrypt', async () => {
  const c = await resolver()(req); expect(c.cliente.contexto).toEqual({ contribuinteId: 'grupo', credencialId: 'cred' }); expect(decrypt).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
  decrypt.mockImplementation(async () => { expect(db.companyCredentialAcesso.create).toHaveBeenCalledTimes(1); return 'segredo'; });
  await c.cliente.consultar({ tiqueteSolicitacao: 'ticket' }); expect(decrypt).toHaveBeenCalledTimes(1);
  expect(db.companyCredentialAcesso.create.mock.calls[0][0].data).toMatchObject({ usuarioId: 'operador', acao: 'REVELADA' });
});
test('reutiliza token entre requisições e impede uso após rotação do cofre', async () => {
  const runtime = resolver(); const a = await runtime(req); await a.cliente.consultar({ tiqueteSolicitacao: 'ticket' }); const b = await runtime(req); await b.cliente.consultar({ tiqueteSolicitacao: 'ticket' }); expect(decrypt).toHaveBeenCalledTimes(1);
  db.companyCredential.findFirst.mockResolvedValue({ id: 'cred', updatedAt: new Date(updatedAt.getTime() + 1) });
  await expect(b.cliente.consultar({ tiqueteSolicitacao: 'ticket' })).rejects.toMatchObject({ code: 'CBS_RUNTIME_BLOQUEADO' }); expect((await runtime(req)).cliente).toBeUndefined(); expect(fetchImpl).toHaveBeenCalledTimes(3);
});
test('configuração alterada e carteira revogada barram cliente previamente resolvido', async () => {
  const c = await resolver()(req); ultimaConfiguracao.mockResolvedValue({ id: 'nova', habilitado: true, dados: {} }); await expect(c.cliente.consultar({ tiqueteSolicitacao: 'ticket' })).rejects.toMatchObject({ code: 'CBS_RUNTIME_BLOQUEADO' });
  carregarGrupo.mockRejectedValue(Object.assign(Error('sem acesso'), { status: 403 })); await expect(c.cliente.baixar({})).rejects.toMatchObject({ code: 'CBS_RUNTIME_BLOQUEADO' }); expect(fetchImpl).not.toHaveBeenCalled();
});

test('revogação antes da abertura declara certeza de ausência de envio', async () => {
  const c = await resolver()(req);
  ultimaConfiguracao.mockResolvedValue({ id: 'revogada', habilitado: false, dados: {} });
  await expect(c.cliente.abrir({ cnpjBase: '12345678', tipo: 'DEBITOS' })).rejects.toMatchObject({ code: 'CBS_RUNTIME_BLOQUEADO', resultadoIncerto: false });
  expect(fetchImpl).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled();
});
test('falha de auditoria impede decrypt e token sem vazar mensagem interna', async () => {
  const c = await resolver()(req); db.companyCredentialAcesso.create.mockRejectedValue(Error('segredo-interno')); await expect(c.cliente.consultar({ tiqueteSolicitacao: 'ticket' })).rejects.toMatchObject({ code: 'CBS_CREDENCIAL_INDISPONIVEL' }); expect(decrypt).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
});
test('runtime env ausente ou inválido retorna função OFF sem I/O de startup', async () => {
  const database = { $transaction: jest.fn() }, key = Buffer.alloc(32, 3).toString('base64');
  for (const env of [{}, { CBS_APURACAO_AUTORIZACOES: '[{}]' }, { CBS_APURACAO_CHAVE_BASE64: 'segredo-invalido' },
    { CBS_APURACAO_CHAVE_BASE64: key, CBS_APURACAO_AUTORIZACOES: '{' },
    { CBS_APURACAO_CHAVE_BASE64: key, CBS_APURACAO_AUTORIZACOES: '[null]' },
    { CBS_APURACAO_CHAVE_BASE64: key, CBS_APURACAO_CHAVES_ANTERIORES_BASE64: '["invalida"]' },
    { CBS_APURACAO_CHAVE_BASE64: key, CBS_APURACAO_CHAVES_ANTERIORES_BASE64: JSON.stringify(Array(9).fill(key)) }]) {
    const runtime = criarRuntimeCbsDoAmbiente({ db: database, env }); expect(typeof runtime).toBe('function'); expect(await runtime(req)).toEqual({});
  }
  expect(database.$transaction).not.toHaveBeenCalled();
});
test('chave sem autorização habilita somente replay local; allowlist válida compõe sem rede', async () => {
  const env = { CBS_APURACAO_CHAVE_BASE64: Buffer.alloc(32, 3).toString('base64') };
  const runtime = criarRuntimeCbsDoAmbiente({ db, env }); const deps = await runtime(req); expect(deps.cliente).toBeUndefined(); expect(typeof deps.protecao.decifrar).toBe('function');
  const autorizado = criarRuntimeCbsDoAmbiente({ db, env: { ...env, CBS_APURACAO_AUTORIZACOES: JSON.stringify([permissao]) } }); expect((await autorizado(req)).cliente.contexto.contribuinteId).toBe('grupo'); expect(fetchImpl).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled();
});
