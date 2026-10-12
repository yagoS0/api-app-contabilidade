import { criarClienteCbs } from '../CbsClient.js';

const resposta = (data, status = 200, headers = {}) => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers });
const criar = extras => {
  const fetchImpl = jest.fn(), obterToken = jest.fn(async () => 'token-secreto');
  return { fetchImpl, obterToken, client: criarClienteCbs({ ambiente: 'HOMOLOGACAO', obterToken, fetchImpl, downloadFetchImpl: fetchImpl,
    urlRetorno: 'https://altan.example/cbs/webhook', hostsDownloadPermitidos: ['storagegw.estaleiro.serpro.gov.br'],
    agora: () => new Date('2026-10-11T12:00:00Z'), ...extras }) };
};
const sucesso = { tiqueteSolicitacao: '692b7b25-44cb-4415-8625-2b9522dd7933.B5E08D55', tEASegundos: '120' };
const urlAssinada = 'https://storagegw.estaleiro.serpro.gov.br/arquivo.json?X-Amz-Signature=segredo';
const expira = '2026-10-12T12:00:00Z';

test.each(['DEBITOS', 'CREDITOS'])('abertura %s usa contrato oficial sem competência/cursor e sem retry', async tipo => {
  const { client, fetchImpl } = criar(); fetchImpl.mockResolvedValue(resposta(sucesso, 201));
  await expect(client.abrir({ cnpjBase: '00409834', tipo })).resolves.toEqual(sucesso);
  const [url, options] = fetchImpl.mock.calls[0];
  expect(url).toBe(`https://api.receitafederal.gov.br/apuracao-cbs-prr/v2/${tipo.toLowerCase()}/00409834`);
  expect(options.method).toBe('POST'); expect(options.redirect).toBe('error');
  expect(JSON.parse(options.body)).toEqual({ urlRetorno: 'https://altan.example/cbs/webhook' });
  expect(options.headers.Authorization).toBe('Bearer token-secreto'); expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('produção usa host fixo com caminho distinto', async () => {
  const { client, fetchImpl } = criar({ ambiente: 'PRODUCAO' }); fetchImpl.mockResolvedValue(resposta(sucesso, 201));
  await client.abrir({ cnpjBase: '00409834', tipo: 'DEBITOS' });
  expect(client.ambiente).toBe('PRODUCAO'); expect(fetchImpl.mock.calls[0][0]).toContain('/apuracao-cbs/v2/');
});
test.each(['AB123456', '12345678000100', '../12345', '1234567'])('CNPJ-base %s fora do contrato não consome rede/token', async cnpjBase => {
  const { client, fetchImpl, obterToken } = criar();
  await expect(client.abrir({ cnpjBase, tipo: 'DEBITOS' })).rejects.toMatchObject({ code: 'CBS_CONTEXTO_NAO_SUPORTADO', resultadoIncerto: false });
  expect(fetchImpl).not.toHaveBeenCalled(); expect(obterToken).not.toHaveBeenCalled();
});
test.each([500, 408, 302, 200])('HTTP %s na abertura é incerto e não repete', async status => {
  const { client, fetchImpl } = criar(); fetchImpl.mockResolvedValue(resposta({ token: 'segredo' }, status));
  await expect(client.abrir({ cnpjBase: '00409834', tipo: 'DEBITOS' })).rejects.toMatchObject({ resultadoIncerto: true });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('recusa 429 é explícita; nenhum retry', async () => {
  const { client, fetchImpl } = criar(); fetchImpl.mockResolvedValue(resposta({}, 429));
  await expect(client.abrir({ cnpjBase: '00409834', tipo: 'DEBITOS' })).rejects.toMatchObject({ code: 'CBS_HTTP_429', resultadoIncerto: false });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test.each(['{', '{}', '[]'])('sucesso de abertura malformado preserva incerteza (%s)', async raw => {
  const { client, fetchImpl } = criar(); fetchImpl.mockResolvedValue(resposta(raw, 201));
  await expect(client.abrir({ cnpjBase: '00409834', tipo: 'DEBITOS' })).rejects.toMatchObject({ resultadoIncerto: true });
});
test('erro do transporte não vaza segredo nem é repetido, mesmo com code forjado', async () => {
  const { client, fetchImpl } = criar(); fetchImpl.mockRejectedValue(Object.assign(Error(urlAssinada + ' token-secreto'), { code: 'CBS_FAKE' }));
  const e = await client.abrir({ cnpjBase: '00409834', tipo: 'DEBITOS' }).catch(e => e);
  expect(e.code).toBe('CBS_TRANSPORTE_INDISPONIVEL'); expect(e.resultadoIncerto).toBe(true);
  expect(e.message).not.toMatch(/segredo|Signature/); expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('credencial ausente falha antes do envio', async () => {
  const { client, fetchImpl } = criar({ obterToken: async () => { throw Error('segredo'); } });
  await expect(client.abrir({ cnpjBase: '00409834', tipo: 'DEBITOS' })).rejects.toMatchObject({ code: 'CBS_CREDENCIAL_INDISPONIVEL', resultadoIncerto: false });
  expect(fetchImpl).not.toHaveBeenCalled();
});
test.each(['PENDENTE', 'EM_PROCESSAMENTO', 'ERRO'])('situação %s não exige ticket no retorno e omite payload livre', async estado => {
  const { client, fetchImpl } = criar(); fetchImpl.mockResolvedValue(resposta({ estado, codigoErro: 'APURACAO-408', mensagemErro: urlAssinada }));
  const d = await client.consultar({ tiqueteSolicitacao: sucesso.tiqueteSolicitacao });
  expect(d).toEqual(estado === 'ERRO' ? { estado, codigoErro: 'APURACAO-408' } : { estado });
  expect(fetchImpl.mock.calls[0][1].method).toBe('GET'); expect(JSON.stringify(d)).not.toContain('segredo');
});
test('URL concluída só é devolvida internamente após validar host e expiração', async () => {
  const { client, fetchImpl } = criar(); fetchImpl.mockResolvedValue(resposta({ estado: 'CONCLUIDA', urlAssinada, urlAssinadaExpiraEm: expira }));
  await expect(client.consultar({ tiqueteSolicitacao: sucesso.tiqueteSolicitacao })).resolves.toEqual({ estado: 'CONCLUIDA', urlAssinada, urlAssinadaExpiraEm: expira });
});
test.each(['http://storagegw.estaleiro.serpro.gov.br/a', 'https://127.0.0.1/a', 'https://storagegw.estaleiro.serpro.gov.br.evil.example/a', 'https://user:pass@storagegw.estaleiro.serpro.gov.br/a'])('download recusa URL fora da autorização %s', async url => {
  const { client, fetchImpl } = criar();
  await expect(client.baixar({ urlAssinada: url, urlAssinadaExpiraEm: expira })).rejects.toHaveProperty('code'); expect(fetchImpl).not.toHaveBeenCalled();
});
test('arquivo expirado não consome rede', async () => {
  const { client, fetchImpl } = criar();
  await expect(client.baixar({ urlAssinada, urlAssinadaExpiraEm: '2026-10-11T11:59:59Z' })).rejects.toMatchObject({ code: 'CBS_ARQUIVO_EXPIRADO' }); expect(fetchImpl).not.toHaveBeenCalled();
});
test('download preserva bytes sem encaminhar Bearer; não segue redirect', async () => {
  const { client, fetchImpl, obterToken } = criar(); fetchImpl.mockResolvedValue(resposta(' {"raw":true}\n'));
  expect((await client.baixar({ urlAssinada, urlAssinadaExpiraEm: expira })).toString()).toBe(' {"raw":true}\n');
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined(); expect(fetchImpl.mock.calls[0][1].redirect).toBe('error'); expect(obterToken).not.toHaveBeenCalled();
});
test('limite é aplicado ao stream sem depender de content-length', async () => {
  const { client, fetchImpl } = criar({ maxArquivoBytes: 4 }); fetchImpl.mockResolvedValue(resposta('12345'));
  await expect(client.baixar({ urlAssinada, urlAssinadaExpiraEm: expira })).rejects.toMatchObject({ code: 'CBS_RESPOSTA_EXCEDE_LIMITE' });
});
test('content-length excessivo cancela o stream antes de ler', async () => {
  let cancelado = false;
  const { client, fetchImpl } = criar({ maxArquivoBytes: 4 });
  fetchImpl.mockResolvedValue(new Response(new ReadableStream({ cancel() { cancelado = true; } }), { headers: { 'content-length': '999' } }));
  await expect(client.baixar({ urlAssinada, urlAssinadaExpiraEm: expira })).rejects.toMatchObject({ code: 'CBS_RESPOSTA_EXCEDE_LIMITE' });
  expect(cancelado).toBe(true);
});
test.each(['toString', 'constructor', '__proto__'])('propriedade herdada %s não é ambiente nem recurso', async key => {
  expect(() => criar({ ambiente: key })).toThrow();
  const { client, fetchImpl } = criar();
  await expect(client.abrir({ cnpjBase: '00409834', tipo: key })).rejects.toMatchObject({ code: 'CBS_CONTEXTO_NAO_SUPORTADO' });
  expect(fetchImpl).not.toHaveBeenCalled();
});
test.each(['.', '..', '../a'])('ticket %s não pode normalizar o caminho do endpoint', async tiqueteSolicitacao => {
  const { client, fetchImpl } = criar();
  await expect(client.consultar({ tiqueteSolicitacao })).rejects.toMatchObject({ code: 'CBS_TIQUETE_INVALIDO' });
  expect(fetchImpl).not.toHaveBeenCalled();
});
test('timeout de abertura é incerto sem repetir a requisição', async () => {
  const { client, fetchImpl } = criar({ timeoutMs: 10 });
  fetchImpl.mockImplementation((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))));
  await expect(client.abrir({ cnpjBase: '00409834', tipo: 'DEBITOS' })).rejects.toMatchObject({ code: 'CBS_TEMPO_ESGOTADO', resultadoIncerto: true });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('provedor de token lento tem deadline e não abre coleta', async () => {
  const { client, fetchImpl } = criar({ timeoutMs: 10, obterToken: () => new Promise(() => {}) });
  await expect(client.abrir({ cnpjBase: '00409834', tipo: 'DEBITOS' })).rejects.toMatchObject({ code: 'CBS_CREDENCIAL_INDISPONIVEL', resultadoIncerto: false });
  expect(fetchImpl).not.toHaveBeenCalled();
});
