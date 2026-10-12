import { criarProvedorTokenCbs } from '../CbsOAuth.js';
const fixture = extras => {
  let tempo = 1000000; const reservas = [];
  const reservarEmissao = jest.fn(async ({ agora, janelaMs, limite }) => { if (reservas.filter(t => agora - t < janelaMs).length >= limite) return false; reservas.push(agora); return true; });
  const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ access_token: 'privado', token_type: 'Bearer', expires_in: 3600 })));
  const config = { credencialId: 'cofre-1', lerCredencial: jest.fn(async () => ({ clientId: 'cliente', clientSecret: 'senha' })), reservarEmissao, fetchImpl, agora: () => tempo, ...extras };
  return { config, fetchImpl, reservarEmissao, token: criarProvedorTokenCbs(config), avancar: ms => { tempo += ms; } };
};
test('cache e chamadas concorrentes emitem um token; contrato Basic/form fixo', async () => {
  const f = fixture(); expect(await Promise.all(Array.from({ length: 20 }, () => f.token()))).toEqual(Array(20).fill('privado'));
  expect(await f.token()).toBe('privado'); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(f.reservarEmissao).toHaveBeenCalledTimes(1);
  const [url, opts] = f.fetchImpl.mock.calls[0]; expect(url).toBe('https://api.receitafederal.gov.br/token'); expect(opts.body).toBe('grant_type=client_credentials'); expect(opts.redirect).toBe('error'); expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('cliente:senha').toString('base64')}`);
});
test('margem de expiração renova sem repetir enquanto válido', async () => {
  const f = fixture(); await f.token(); f.avancar(3539000); await f.token(); expect(f.fetchImpl).toHaveBeenCalledTimes(1); f.avancar(1000); await f.token(); expect(f.fetchImpl).toHaveBeenCalledTimes(2);
});
test('reserva compartilhada barra terceira emissão entre instâncias, inclusive falhas', async () => {
  const f = fixture({ fetchImpl: jest.fn(async () => { throw new Error('secret-sensitive'); }) });
  await expect(f.token()).rejects.toMatchObject({ code: 'CBS_OAUTH_INDISPONIVEL' });
  await expect(criarProvedorTokenCbs(f.config)()).rejects.toMatchObject({ code: 'CBS_OAUTH_INDISPONIVEL' });
  await expect(criarProvedorTokenCbs(f.config)()).rejects.toMatchObject({ code: 'CBS_OAUTH_LIMITE' });
  expect(f.config.fetchImpl).toHaveBeenCalledTimes(2); f.avancar(3600000); await expect(f.token()).rejects.toMatchObject({ code: 'CBS_OAUTH_INDISPONIVEL' }); expect(f.config.fetchImpl).toHaveBeenCalledTimes(3);
});
test.each([{ access_token: 'x', expires_in: 3600 }, { access_token: 'x\r\n', token_type: 'Bearer', expires_in: 3600 }, { access_token: 'x', token_type: 'Bearer', expires_in: 3601 }, { access_token: 'x', token_type: 'Bearer', expires_in: '3600' }, { access_token: 'x', token_type: 'Bearer', expires_in: 10 }])('resposta inválida não vira cache %#', async data => {
  const f = fixture({ fetchImpl: jest.fn(async () => new Response(JSON.stringify(data))) }); await expect(f.token()).rejects.toMatchObject({ code: 'CBS_OAUTH_RESPOSTA' });
});
test('resposta excessiva cancelada e sanitizada', async () => {
  const f = fixture({ fetchImpl: jest.fn(async () => new Response('x'.repeat(17000))) }); await expect(f.token()).rejects.toMatchObject({ code: 'CBS_OAUTH_RESPOSTA' });
});
test('timeout encerra emissão pendente, não reinicia automaticamente', async () => {
  const f = fixture({ timeoutMs: 10, fetchImpl: jest.fn(() => new Promise(() => {})) }); await expect(f.token()).rejects.toMatchObject({ code: 'CBS_OAUTH_TIMEOUT' }); expect(f.config.fetchImpl).toHaveBeenCalledTimes(1);
});
test('cancelamento de consumidor não interrompe token compartilhado', async () => {
  let liberar; const f = fixture({ fetchImpl: jest.fn(() => new Promise(resolve => { liberar = resolve; })) });
  const controller = new AbortController(); const a = f.token({ signal: controller.signal }); const b = f.token(); await Promise.resolve(); await Promise.resolve(); controller.abort();
  await expect(a).rejects.toMatchObject({ code: 'CBS_OAUTH_CANCELADO' }); liberar(new Response(JSON.stringify({ access_token: 'privado', token_type: 'Bearer', expires_in: 3600 }))); expect(await b).toBe('privado'); expect(f.config.fetchImpl).toHaveBeenCalledTimes(1);
});
test('sem reserva durável não constrói provider', () => { expect(() => criarProvedorTokenCbs({ credencialId: 'x', lerCredencial: async () => ({}) })).toThrow(); });
test('erro de cofre não revela mensagem, segredo ou causa', async () => { const f = fixture({ lerCredencial: async () => { throw new Error('super-segredo'); } }); await expect(f.token()).rejects.toThrow('Autenticação CBS indisponível.'); expect(f.reservarEmissao).not.toHaveBeenCalled(); });
