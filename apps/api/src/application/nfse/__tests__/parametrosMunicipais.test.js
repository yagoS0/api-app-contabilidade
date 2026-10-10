jest.mock('../../../config.js', () => ({ NFSE_ENV: 'homolog', INTEGRACAO_PARAMETROS_MUNICIPAIS: false }));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../nfseCertificado.js', () => ({ resolverCertificadosDaEmpresa: jest.fn() }));
import { criarClienteParametros, caminhoParametros, BASES_PARAMETROS } from '../parametrosMunicipaisClient.js';
import { criarServicoParametros } from '../parametrosMunicipaisService.js';

const entrada = { municipio: '3304557', recurso: 'servico', codigoServico: '171901001' };
const pedido = { portalClientId: 'portal', autorId: 'contador', requestKey: 'consulta-123456789', ...entrada, codigoServico: '171901', codigoServicoMunicipal: '001' };
function montar(extra = {}) {
  const registros = [];
  const db = { portalClient: { findUnique: jest.fn(async () => ({ companyId: 'legada' })) },
    company: { findUnique: jest.fn(async () => ({ id: 'legada', codigoMunicipioIbge: '3304557', codigoServicoNacional: '171901' })) },
    nfseConsultaMunicipal: {
      findUnique: jest.fn(async ({ where }) => registros.find(r => r.requestKey === where.companyId_ambiente_requestKey.requestKey)),
      findMany: jest.fn(async () => registros),
      create: jest.fn(async ({ data }) => { const r = { id: 'consulta', ...data }; registros.push(r); return r; }),
      update: jest.fn(async ({ data }) => Object.assign(registros[0], data)),
    } };
  const client = { origem: BASES_PARAMETROS.homolog, consultar: jest.fn(async () => ({ resposta: { exemplo: true } })), fechar: jest.fn() };
  const resolverCertificados = jest.fn(async () => ({ transporte: { pfxBuffer: Buffer.from('teste') } }));
  const criarCliente = jest.fn(() => client);
  return { registros, db, client, resolverCertificados, criarCliente,
    service: criarServicoParametros({ db, ambiente: 'homolog', habilitado: true, resolverCertificados, criarCliente, ...extra }) };
}

test('caminhos documentados; rejeita recurso de manutenção e injeção de caminho', () => {
  expect(caminhoParametros(entrada)).toBe('/3304557/17.19.01.001/historicoaliquotas');
  expect(caminhoParametros({ ...entrada, recurso: 'convenio' })).toBe('/3304557/convenio');
  for (const caso of [{ municipio: '../segredo' }, { recurso: 'retencoes' }, { codigoServico: '171901/..' }, { codigoServico: '171901' }]) {
    expect(() => caminhoParametros({ ...entrada, ...caso })).toThrow();
  }
});
test.each(['homolog', 'producao'])('transporte isolado e verificado em %s', async ambiente => {
  const http = { get: jest.fn(async () => ({ status: 200, data: '{"valor":0}' })) };
  const criarHttp = jest.fn(() => http);
  const c = criarClienteParametros({ ambiente, certificado: { pfxBuffer: Buffer.from('fake') }, criarHttp });
  expect(criarHttp.mock.calls[0][0]).toMatchObject({ baseURL: BASES_PARAMETROS[ambiente], maxRedirects: 0, timeout: 15000 });
  expect(criarHttp.mock.calls[0][0].httpsAgent.options.rejectUnauthorized).toBe(true);
  expect(await c.consultar(entrada)).toMatchObject({ resposta: { valor: 0 } });
  c.fechar();
});
test.each(['<html>Login</html>', 'null', 'true', '', 'x'.repeat(1024 * 1024 + 1)])('resposta não documental é recusada (%#)', async data => {
  const c = criarClienteParametros({ ambiente: 'homolog', certificado: { pfxBuffer: Buffer.from('fake') },
    criarHttp: () => ({ get: async () => ({ status: 200, data }) }) });
  await expect(c.consultar(entrada)).rejects.toMatchObject({ code: 'NFSE_PARAMETROS_RESPOSTA_INVALIDA' });
  c.fechar();
});

test('PEM já extraído evita reabrir PFX legado no OpenSSL sem desativar validação TLS', async () => {
  const criarHttp = jest.fn(() => ({ get: async () => ({ status: 200, data: '{}' }) }));
  const c = criarClienteParametros({ ambiente: 'homolog', certificado: {
    pfxBuffer: Buffer.from('legado'), password: 'segredo', certPem: 'CERT', keyPem: 'KEY',
  }, criarHttp });
  const options = criarHttp.mock.calls[0][0].httpsAgent.options;
  expect(options).toMatchObject({ cert: 'CERT', key: 'KEY', rejectUnauthorized: true });
  expect(options).not.toHaveProperty('pfx');
  expect(options).not.toHaveProperty('passphrase');
  await expect(c.consultar(entrada)).resolves.toMatchObject({ resposta: {} });
  c.fechar();
});

test.each(['ERR_CRYPTO_UNSUPPORTED_OPERATION', 'EPROTO'])('falha nativa %s é de transporte, sem supor resposta HTTP', async code => {
  const c = criarClienteParametros({ ambiente: 'homolog', certificado: { pfxBuffer: Buffer.from('fake') },
    criarHttp: () => ({ get: async () => { throw Object.assign(new Error('segredo'), { code }); } }) });
  await expect(c.consultar(entrada)).rejects.toMatchObject({ code: 'NFSE_PARAMETROS_CONSULTA_FALHOU', httpStatus: null });
  c.fechar();
});
test.each([[404, 'NFSE_PARAMETROS_NAO_LOCALIZADOS'], [403, 'NFSE_PARAMETROS_ACESSO_RECUSADO'], [500, 'NFSE_PARAMETROS_CONSULTA_FALHOU']])('HTTP %s não vaza erro nem vira isenção', async (status, code) => {
  const c = criarClienteParametros({ ambiente: 'homolog', certificado: { pfxBuffer: Buffer.from('fake') }, criarHttp: () => ({ get: async () => {
    throw { isAxiosError: true, response: { status, data: 'segredo' }, config: { pfx: 'segredo' } };
  } }) });
  await expect(c.consultar(entrada)).rejects.toMatchObject({ code, httpStatus: status });
  try { await c.consultar(entrada); } catch (err) { expect(JSON.stringify(err)).not.toContain('segredo'); }
  c.fechar();
});
test('certificado da empresa legada, reserva antes da rede e histórico da consulta', async () => {
  const m = montar();
  m.client.consultar.mockImplementation(async () => {
    expect(m.registros[0]).toMatchObject({ status: 'CONSULTANDO', autorId: 'contador', companyId: 'legada', ambiente: 'homolog' });
    return { resposta: { periodos: [] } };
  });
  const r = await m.service.consultar(pedido);
  expect(m.resolverCertificados).toHaveBeenCalledWith('legada');
  expect(r).toMatchObject({ status: 'RECEBIDO_PARA_CONFERENCIA', resposta: { periodos: [] } });
  expect(r).not.toHaveProperty('vigenciaInicio');
  expect(m.client.fechar).toHaveBeenCalled();
});
test('mesmo identificador recupera resultado sem consulta adicional; mudança de pedido recusa', async () => {
  const m = montar();
  await m.service.consultar(pedido);
  await m.service.consultar(pedido);
  expect(m.client.consultar).toHaveBeenCalledTimes(1);
  await expect(m.service.consultar({ ...pedido, recurso: 'convenio' })).rejects.toMatchObject({ code: 'NFSE_PARAMETROS_CONFLITO' });
});
test('falha de rede é preservada sem apagar retorno anterior ou repetir automaticamente', async () => {
  const m = montar();
  m.client.consultar.mockRejectedValue({ code: 'NFSE_PARAMETROS_CONSULTA_FALHOU', httpStatus: 503 });
  expect(await m.service.consultar(pedido)).toMatchObject({ status: 'FALHOU', httpStatus: 503 });
  await m.service.consultar(pedido);
  expect(m.client.consultar).toHaveBeenCalledTimes(1);
});
test('falha de gravação antes da rede impede consulta', async () => {
  const m = montar(); m.db.nfseConsultaMunicipal.create.mockRejectedValue(new Error('db'));
  await expect(m.service.consultar(pedido)).rejects.toThrow('db');
  expect(m.client.consultar).not.toHaveBeenCalled();
  expect(m.client.fechar).toHaveBeenCalled();
});
test('falha de gravação do retorno mantém reserva e impede replay', async () => {
  const m = montar(); m.db.nfseConsultaMunicipal.update.mockRejectedValue(new Error('db'));
  await expect(m.service.consultar(pedido)).rejects.toThrow('db');
  expect(await m.service.consultar(pedido)).toMatchObject({ status: 'CONSULTANDO' });
  expect(m.client.consultar).toHaveBeenCalledTimes(1);
});
test('leitura não consulta rede e filtra empresa e ambiente', async () => {
  const m = montar(); await m.service.listar('portal');
  expect(m.db.nfseConsultaMunicipal.findMany.mock.calls[0][0].where).toEqual({ companyId: 'legada', ambiente: 'homolog' });
  expect(m.resolverCertificados).not.toHaveBeenCalled(); expect(m.client.consultar).not.toHaveBeenCalled();
});
test('flag desligada não consulta nem depende da tabela nova', async () => {
  const m = montar({ habilitado: false });
  expect(await m.service.listar('portal')).toMatchObject({ habilitado: false, consultas: [] });
  await expect(m.service.consultar(pedido)).rejects.toMatchObject({ code: 'NFSE_PARAMETROS_DESABILITADOS' });
  expect(m.db.nfseConsultaMunicipal.findMany).not.toHaveBeenCalled();
  expect(m.client.consultar).not.toHaveBeenCalled();
});
test('serviço fora do cadastro não usa certificado nem rede', async () => {
  const m = montar(); await expect(m.service.consultar({ ...pedido, codigoServico: '010101' })).rejects.toThrow(/cadastrado/);
  expect(m.resolverCertificados).not.toHaveBeenCalled();
});

test('consulta preserva o complemento municipal explícito e recusa ausência antes da rede', async () => {
  const m = montar();
  await expect(m.service.consultar({ ...pedido, codigoServicoMunicipal: undefined })).rejects.toMatchObject({ code: 'NFSE_PARAMETROS_ENTRADA_INVALIDA' });
  expect(m.resolverCertificados).not.toHaveBeenCalled();
  await m.service.consultar(pedido);
  expect(m.client.consultar).toHaveBeenCalledWith(entrada);
  expect(m.registros[0]).toMatchObject({ codigoServico: '171901001', caminho: '/3304557/17.19.01.001/historicoaliquotas' });
  await expect(m.service.consultar({ ...pedido, codigoServicoMunicipal: '002' })).rejects.toMatchObject({ code: 'NFSE_PARAMETROS_CONFLITO' });
});
test('duas consultas concorrentes com a mesma chave fazem um único GET', async () => {
  const m = montar();
  m.db.nfseConsultaMunicipal.create.mockImplementation(async ({ data }) => {
    if (m.registros.length) throw { code: 'P2002' };
    const r = { id: 'consulta', ...data }; m.registros.push(r); return r;
  });
  await Promise.all([m.service.consultar(pedido), m.service.consultar(pedido)]);
  expect(m.client.consultar).toHaveBeenCalledTimes(1);
});
test('certificado inválido não grava tentativa nem consulta rede', async () => {
  const m = montar(); m.resolverCertificados.mockRejectedValue(Object.assign(new Error('certificado'), { code: 'NO_COMPANY_CERT' }));
  await expect(m.service.consultar(pedido)).rejects.toMatchObject({ code: 'NO_COMPANY_CERT' });
  expect(m.db.nfseConsultaMunicipal.create).not.toHaveBeenCalled(); expect(m.client.consultar).not.toHaveBeenCalled();
});
