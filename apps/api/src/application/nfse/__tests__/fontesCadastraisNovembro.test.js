import fs from 'node:fs';
import path from 'node:path';
import { criarClienteRfbCnpj } from '../rfbCnpjClient.js';
import { conferirConvenioMunicipal } from '../convenioMunicipalCompetencia.js';
import { conferirFontesNovembro2026 } from '../laboratorio/conferirFontesNovembro2026.js';
import { xmlBase } from './fixtures/dpsNovembro2026.js';
const cnpj = '11222333000181';
const resposta = () => ({ ni: cnpj, dataAbertura: '2020-01-01', endereco: { cep: '20040002', municipio: { codigo: '6001', descricao: 'Rio de Janeiro' }, uf: 'RJ' } });
const agora = () => new Date('2026-10-12T12:00:00Z');
function cliente() {
  const http = { post: jest.fn(async () => ({ status: 200, data: { access_token: 'segredo-token', expires_in: 3600 } })), get: jest.fn(async () => ({ status: 200, data: resposta() })) };
  const criarHttp = jest.fn(() => http);
  return { http, criarHttp, client: criarClienteRfbCnpj({ consumerKey: 'chave', consumerSecret: 'segredo', criarHttp, agora }) };
}
test('CNPJ oficial usa token e endpoint fixo, conserva data sem inventar vigência', async () => {
  const m = cliente(); const r = await m.client.consultar(cnpj); await m.client.consultar(cnpj);
  expect(m.http.post).toHaveBeenCalledTimes(1); expect(m.http.get.mock.calls[0][0]).toBe(`/consulta-cnpj-df/v2/basica/${cnpj}`);
  expect(m.criarHttp).toHaveBeenCalledWith(expect.objectContaining({ maxRedirects: 0, timeout: 8000 }));
  expect(r).toMatchObject({ ok: true, fonte: 'RFB_SERPRO', vigenciaComprovada: false, dataAbertura: '2020-01-01' });
  expect(r.sha256).toMatch(/^[a-f0-9]{64}$/); expect(r).not.toHaveProperty('vigenciaInicio'); expect(r).not.toHaveProperty('municipioIbge');
  expect(JSON.stringify(r)).not.toContain('segredo');
});
test.each(['12345678909','11222333000182','../token',''])('recusa documento inválido sem rede: %s', async doc => {
  const m = cliente(); expect((await m.client.consultar(doc)).ok).toBe(false); expect(m.http.post).not.toHaveBeenCalled();
});
test('sem credenciais específicas não usa credenciais de outro produto', async () => {
  const http = { post: jest.fn(), get: jest.fn() };
  const r = await criarClienteRfbCnpj({ criarHttp: () => http }).consultar(cnpj);
  expect(r.motivo).toBe('RFB_CNPJ_NAO_CONFIGURADO'); expect(http.post).not.toHaveBeenCalled();
});
test.each([401,403,404,500])('HTTP %s não vira inexistência histórica nem vaza corpo', async status => {
  const m = cliente(); m.http.get.mockRejectedValue({ response: { status, data: 'segredo' }, config: { token: 'segredo' } });
  const r = await m.client.consultar(cnpj); expect(r.ok).toBe(false); expect(r.vigenciaComprovada).toBe(false); expect(JSON.stringify(r)).not.toContain('segredo');
});
test('resposta de outro documento e esquema antigo são recusados', async () => {
  const m = cliente(); m.http.get.mockResolvedValue({ status: 200, data: { ...resposta(), ni: 'outro' } });
  expect((await m.client.consultar(cnpj)).motivo).toBe('RFB_RESPOSTA_INVALIDA');
  m.http.get.mockResolvedValue({ status: 200, data: { ni: cnpj, data_abertura: '2020-01-01' } });
  expect((await m.client.consultar(cnpj)).motivo).toBe('RFB_RESPOSTA_INVALIDA');
});
const escopo = { companyId: 'empresa', ambiente: 'homolog', municipio: '3304557', competencia: '2026-11-03' };
const registro = () => ({ ...escopo, id: 'consulta', recurso: 'convenio', caminho: '/3304557/convenio', origem: 'https://adn.producaorestrita.nfse.gov.br/parametrizacao', status: 'RECEBIDO_PARA_CONFERENCIA', httpStatus: 200, concluidaEm: '2026-10-12T12:00:00Z', resposta: { parametrosConvenio: { aderenteAmbienteNacional: 1, aderenteEmissorNacional: 1, situacaoEmissaoPadraoContribuintesRFB: 1, aderenteMAN: 0, permiteAproveitametoDeCreditos: true } } });
test('contrato oficial não contém vigência nem autorização de dedução', () => {
  let root = process.cwd(); while (!fs.existsSync(path.join(root,'docs/leiaute-nfse/adn-contrato-convenio.json'))) { const pai = path.dirname(root); if (pai === root) throw Error('Contrato ausente'); root = pai; }
  const contrato = JSON.parse(fs.readFileSync(path.join(root,'docs/leiaute-nfse/adn-contrato-convenio.json'),'utf8'));
  expect(Object.keys(contrato.schemas.ParametrosConfiguracaoConvenio.properties)).not.toContain('vigenciaInicio');
  const r = conferirConvenioMunicipal({ ...escopo, consultas: [registro()] });
  expect(r).toMatchObject({ vigenciaComprovada: false, permissoesComprovadas: false, motivo: 'CONTRATO_ADN_SEM_VIGENCIA_E_PERMISSOES' });
  expect(r.observacoes[0].sha256).toMatch(/^[a-f0-9]{64}$/);
});
test.each([['companyId','outra'],['ambiente','producao'],['origem','falsa'],['status','FALHOU']])('convênio respeita escopo %s', (k,v) => {
  expect(conferirConvenioMunicipal({ ...escopo, consultas: [{ ...registro(), [k]: v }] }).observacoes).toHaveLength(0);
});
test('convênios contraditórios não selecionam o mais permissivo', () => {
  const a = registro(), b = registro(); b.resposta.parametrosConvenio.aderenteEmissorNacional = 0;
  expect(conferirConvenioMunicipal({ ...escopo, consultas: [a,b] }).motivo).toBe('CONVENIO_RESPOSTAS_DIVERGENTES');
});
const entrada = { xmlBase, contrato: 'NT009_V1_01_NOVEMBRO_2026' };
function fontes() {
  return { rfb: { consultar: jest.fn(async () => ({ ok: true, fonte: 'RFB_SERPRO', municipioDescricao: 'Rio de Janeiro', uf: 'RJ', vigenciaComprovada: false })) },
    cep: jest.fn(async () => ({ ok: true, endereco: { cMun: '3304557' } })), carregarMunicipios: jest.fn(async () => [['3304557','Rio de Janeiro','RJ']]), agora };
}
test('consulta ligada à preparação preserva XML e pendências históricas', async () => {
  const f = fontes(), r = await conferirFontesNovembro2026(entrada,f);
  expect(f.rfb.consultar).toHaveBeenCalledWith(cnpj); expect(f.cep).toHaveBeenCalledWith('20040002',expect.any(Object));
  expect(r.consultasCadastrais[0].cadastro).toMatchObject({ municipioIbge: '3304557', coincideMunicipioXml: true });
  expect(r.consultasCadastrais[0].postal.vigenciaComprovada).toBe(false); expect(r.liberadoParaEmissao).toBe(false); expect(r.transmitido).toBe(false);
  expect(r.pendencias).toContain('CADASTRO_RFB_POR_COMPETENCIA');
});
test.each([['2026-11-03</dCompet>','2027-01-01</dCompet>'],['<tpAmb>2','<tpAmb>1'],['</DPS>','<Signature/></DPS>']])('travas executam antes da rede', async (a,b) => {
  const f = fontes(); await expect(conferirFontesNovembro2026({ ...entrada, xmlBase: xmlBase.replace(a,b) },f)).rejects.toThrow();
  expect(f.rfb.consultar).not.toHaveBeenCalled(); expect(f.cep).not.toHaveBeenCalled(); expect(f.carregarMunicipios).not.toHaveBeenCalled();
});
