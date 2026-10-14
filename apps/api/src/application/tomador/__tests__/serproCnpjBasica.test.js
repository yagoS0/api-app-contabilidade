import { criarSerproCnpjBasica, criarSerproCnpjEmpresa, mapearSerproBasica } from '../serproCnpjBasica.js';

const CNPJ = '11222333000181';
const body = { ni: CNPJ, nomeEmpresarial: 'EMPRESA SINTETICA',
  endereco: { tipoLogradouro: 'RUA', logradouro: 'TESTE', numero: '10', bairro: 'CENTRO', cep: '20040020',
    municipio: { codigo: '6001', descricao: 'RIO DE JANEIRO' }, uf: 'RJ' },
  socios: [{ cpf: 'dado que não deve sair' }] };
const resposta = (status, data) => ({ status, json: async () => data });
const token = () => resposta(200, { access_token: 'token-sintetico', expires_in: 3600 });
const opts = { habilitado: true, consumerKey: 'key-sintetica', consumerSecret: 'secret-sintetico' };
afterEach(() => jest.useRealTimers());

test('desabilitado por padrão, mesmo com credenciais', async () => {
  const fetchImpl = jest.fn();
  const client = criarSerproCnpjBasica({ ...opts, habilitado: undefined, fetchImpl });
  expect(await client.consultar(CNPJ)).toMatchObject({ ok: false, motivo: 'serpro_desabilitado' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each(['12345678000190', '12345678909', 'A11222333000181'])('documento inválido não autentica: %s', async doc => {
  const fetchImpl = jest.fn();
  expect((await criarSerproCnpjBasica({ ...opts, fetchImpl }).consultar(doc)).ok).toBe(false);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('chama somente Básica, reaproveita token e converte TOM com prova oficial', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(token()).mockResolvedValue(resposta(200, body));
  const client = criarSerproCnpjBasica({ ...opts, fetchImpl });
  const out = await client.consultar(CNPJ, { municipios: [['3304557', 'Rio de Janeiro', 'RJ']] });
  expect(out).toMatchObject({ ok: true, fonte: 'SERPRO_BASICA', tomador: { nome: body.nomeEmpresarial, endereco: { cMun: '3304557' } } });
  expect(out.bruto.codigo_municipio_ibge).toBe('3304557');
  expect(out.bruto.socios).toBeUndefined();
  await client.consultar(CNPJ);
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
    'https://gateway.apiserpro.serpro.gov.br/token',
    `https://gateway.apiserpro.serpro.gov.br/consulta-cnpj-df/v2/basica/${CNPJ}`,
    `https://gateway.apiserpro.serpro.gov.br/consulta-cnpj-df/v2/basica/${CNPJ}`,
  ]);
  expect(fetchImpl.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true);
});

test('conteúdo parcial 206 conserva campos e exige mesma identidade', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(token()).mockResolvedValue(resposta(206, { ni: CNPJ, nomeEmpresarial: 'TESTE' }));
  expect(await criarSerproCnpjBasica({ ...opts, fetchImpl }).consultar(CNPJ)).toMatchObject({ ok: true, tomador: { nome: 'TESTE', endereco: null } });
  expect(mapearSerproBasica({ ...body, ni: 'outro' }, CNPJ)).toBeNull();
});

test('401 pago invalida token sem repetir a consulta', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(token()).mockResolvedValue(resposta(401, {}));
  const out = await criarSerproCnpjBasica({ ...opts, fetchImpl }).consultar(CNPJ);
  expect(out).toMatchObject({ ok: false, resultadoIncerto: true });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('timeout inclui JSON e não repete consulta mesmo quando fetch ignora abort', async () => {
  jest.useFakeTimers();
  const fetchImpl = jest.fn().mockResolvedValueOnce(token()).mockResolvedValue({ status: 200, json: () => new Promise(() => {}) });
  const pending = criarSerproCnpjBasica({ ...opts, fetchImpl, timeoutMs: 100 }).consultar(CNPJ);
  await jest.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ ok: false, motivo: 'serpro_timeout', resultadoIncerto: true });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('autenticação que termina após timeout não inicia chamada faturável', async () => {
  jest.useFakeTimers();
  let resolver;
  const fetchImpl = jest.fn(() => new Promise(resolve => { resolver = resolve; }));
  const pending = criarSerproCnpjBasica({ ...opts, fetchImpl, timeoutMs: 100 }).consultar(CNPJ);
  await jest.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ ok: false, resultadoIncerto: false });
  resolver(token());
  await jest.advanceTimersByTimeAsync(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('erros não devolvem segredo ou mensagem do fornecedor', async () => {
  const fetchImpl = jest.fn().mockRejectedValue(new Error('secret-sintetico'));
  expect(JSON.stringify(await criarSerproCnpjBasica({ ...opts, fetchImpl }).consultar(CNPJ))).not.toContain('secret-sintetico');
});

test.each([['02', 'ATIVA'], ['08', 'BAIXADA'], ['99', '']])('situação %s usa a descrição oficial', (codigo, descricao) => {
  expect(mapearSerproBasica({ ...body, situacaoCadastral: { codigo } }, CNPJ).descricao_situacao_cadastral).toBe(descricao);
});
test('Empresa é modalidade fixa do cadastro e mapeia sócios sem inventar participação',async()=>{
  const fetchImpl=jest.fn().mockResolvedValueOnce(token()).mockResolvedValue(resposta(200,{...body,socios:[{nome:'SOCIO SINTETICO',cpf:'52998224725',qualificacao:'49'}]}));
  const r=await criarSerproCnpjEmpresa({...opts,fetchImpl}).consultar(CNPJ);
  expect(fetchImpl.mock.calls[1][0]).toContain('/v2/empresa/');
  expect(r).toMatchObject({modalidade:'EMPRESA',bruto:{qsa:[{nome_socio:'SOCIO SINTETICO',cnpj_cpf_do_socio:'52998224725',qualificacao_socio:'49'}]}});
  expect(r.bruto.qsa[0].participacao).toBeUndefined();
});
