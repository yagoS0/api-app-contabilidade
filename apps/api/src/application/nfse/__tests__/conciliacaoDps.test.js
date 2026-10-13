import { gzipSync } from 'node:zlib';
import { conciliarDps } from '../conciliacaoDps.js';
const ns = 'http://www.sped.fazenda.gov.br/nfse';
const idDps = 'DPS330455721234567800019900001000000000000001';
const cnpjPrestador = '12345678000199';
const chave = '3'.repeat(50);
const inf = `<infDPS Id="${idDps}"><tpAmb>1</tpAmb><dhEmi>2026-10-13T10:00:00-03:00</dhEmi><verAplic>v1</verAplic><serie>1</serie><nDPS>1</nDPS><dCompet>2026-10-13</dCompet><prest><CNPJ>${cnpjPrestador}</CNPJ></prest><toma><CPF>12345678909</CPF><xNome>Teste</xNome></toma><serv><cServ><cTribNac>010101</cTribNac><xDescServ>Serviço teste</xDescServ></cServ></serv><valores><vServPrest><vServ>100.00</vServ></vServPrest></valores></infDPS>`;
const dps = body => `<DPS xmlns="${ns}" versao="1.01">${body}</DPS>`;
const nfse = body => `<NFSe xmlns="${ns}"><infNFSe Id="NFS${chave}"><nNFSe>265</nNFSe><cStat>100</cStat>${dps(body)}</infNFSe></NFSe>`;
function cenario(xml = nfse(inf)) {
  const client = { get: jest.fn().mockResolvedValueOnce({ status: 200, data: { chaveAcesso: chave } }).mockResolvedValueOnce({ status: 200, data: { nfseXmlGZipB64: gzipSync(xml).toString('base64') } }), post: jest.fn() };
  const clientEventos = { get: jest.fn().mockResolvedValue({ status: 200, data: { TipoAmbiente: 1, StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [] } }), post: jest.fn() };
  return { client, clientEventos, idDps, cnpjPrestador, ambiente: 1, xmlEnviado: dps(inf) };
}
test('mesma operação só após consultas DPS, XML e eventos; preserva número autorizado', async () => {
  const params = cenario();
  expect(await conciliarDps(params)).toMatchObject({ estado: 'MESMA', numeroNfse: '265', chaveAcesso: chave, xml: nfse(inf) });
  expect(params.client.get.mock.calls.map(c => c[0])).toEqual([`/dps/${idDps}`, `/nfse/${chave}`]);
  expect(params.client.post).not.toHaveBeenCalled();
  expect(params.clientEventos.get).toHaveBeenCalledWith(`/NFSe/${chave}/Eventos`, expect.objectContaining({ timeout: 15000, maxRedirects: 0 }));
  expect(params.clientEventos.post).not.toHaveBeenCalled();
});

test.each([{}, { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [{}] }, { StatusProcessamento: 'REJEICAO' }, { TipoAmbiente: 2 }, { Erros: [{}] }, { Erros: undefined }, { LoteDFe: undefined }, { Alertas: [{}] }])('eventos ausentes, divergentes ou ambíguos não recuperam: %j', async alteracao => {
  const p = cenario();
  const data = Object.keys(alteracao).length ? { TipoAmbiente: 1, StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [], ...alteracao } : {};
  p.clientEventos.get.mockResolvedValue({ status: 200, data });
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA', motivo: 'SITUACAO_EVENTOS_NAO_COMPROVADA' });
});

test.each([[null, null], [null, []], [[], null]])('ausência explícita admite nullable documentado: %j %j', async (LoteDFe, Erros) => {
  const p = cenario();
  p.clientEventos.get.mockResolvedValue({ status: 200, data: { TipoAmbiente: 1, StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe, Erros } });
  expect(await conciliarDps(p)).toMatchObject({ estado: 'MESMA', eventosConferidos: true });
});

test.each(['LoteDFe', 'Erros'])('propriedade ausente %s não equivale a null explícito', async campo => {
  const p = cenario();
  const data = { TipoAmbiente: 1, StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: null, Erros: null };
  delete data[campo]; p.clientEventos.get.mockResolvedValue({ status: 200, data });
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA' });
});

test.each([{ StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: null, Erros: null }, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [{}], Erros: null }, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: null, Erros: [{}] }])('contradição no envelope não libera: %j', async dados => {
  const p = cenario(); p.clientEventos.get.mockResolvedValue({ status: 200, data: { TipoAmbiente: 1, ...dados } });
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA' });
});

test.each([404, 500])('erro de eventos HTTP%s sem ausência explícita não libera', async status => {
  const p = cenario(); p.clientEventos.get.mockRejectedValue({ response: { status, data: {} } });
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA' });
});

test('404 ADN com envelope completo de ausência é válido', async () => {
  const p = cenario(); p.clientEventos.get.mockRejectedValue({ response: { status: 404, data: { TipoAmbiente: 1, StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [] } } });
  expect(await conciliarDps(p)).toMatchObject({ estado: 'MESMA', eventosConferidos: true });
});

test('sem cliente de eventos equivalência fiscal não prova situação atual', async () => {
  const p = cenario(); delete p.clientEventos;
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA', motivo: 'CONSULTA_EVENTOS_INDISPONIVEL' });
});

test('outra operação comprova ocupação sem consultar eventos', async () => {
  const p = cenario(nfse(inf.replace('100.00', '101.00')));
  expect(await conciliarDps(p)).toMatchObject({ estado: 'OUTRA' });
  expect(p.clientEventos.get).not.toHaveBeenCalled();
});
test.each([
  ['2026-10-13T10:00:00-03:00', '2026-10-13T11:00:00-03:00'], ['<verAplic>v1', '<verAplic>v2'],
])('ignora somente metadado permitido %s', async (a, b) => expect(await conciliarDps(cenario(nfse(inf.replace(a, b))))).toMatchObject({ estado: 'MESMA' }));
test.each([
  ['12345678909', '12345678908', 'tomador'], ['<dCompet>2026-10-13', '<dCompet>2026-10-12', 'competencia'], ['100.00', '101.00', 'valor'], ['Serviço teste', 'Outro serviço', 'descricao'],
])('operação claramente diferente: %s', async (a, b, campo) => expect(await conciliarDps(cenario(nfse(inf.replace(a, b))))).toMatchObject({ estado: 'OUTRA', camposDivergentes: [campo] }));
test.each([['010101', '010102'], ['<xNome>Teste', '<xNome>Outro'], ['100.00', '100.0']])('diferença não resolvida não é considerada a mesma: %s', async (a, b) => expect(await conciliarDps(cenario(nfse(inf.replace(a, b))))).toMatchObject({ estado: 'INCONCLUSIVA' }));
test.each([
  nfse(inf).replace(idDps, `${idDps}9`), nfse(inf).replace('<tpAmb>1', '<tpAmb>2'), nfse(inf).replace(cnpjPrestador, '99999999000199'),
  nfse(inf).replace(`NFS${chave}`, `NFS${'4'.repeat(50)}`), nfse(inf).replace('</infNFSe>', `${dps(inf)}</infNFSe>`),
  nfse(inf).replace('</infNFSe>', '<evento/></infNFSe>'), nfse(inf).replace('<nNFSe>265', '<nNFSe>0'),
  '<!DOCTYPE NFSe [<!ENTITY a "b">]>' + nfse(inf), nfse(inf).replace('</NFSe>', ''), '<html>erro</html>',
  nfse(inf).replace(ns, 'urn:errado'), nfse(inf).replace('</NFSe>', `<extra/> </NFSe>`).replace('<extra/>', dps(inf)),
])('recusa documento inválido/ambíguo sem conciliar %#', async xml => expect(await conciliarDps(cenario(xml))).toMatchObject({ estado: 'INCONCLUSIVA' }));
test('XML de entrada com identidade divergente não consulta', async () => {
  const p = cenario(); p.cnpjPrestador = '99999999000199';
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA' }); expect(p.client.get).not.toHaveBeenCalled();
});
test.each([{}, { chaveAcesso: '3'.repeat(48) }, { chaveAcesso: 123 }])('retorno sem chave50 não busca XML %j', async data => {
  const p = cenario(); p.client.get.mockReset().mockResolvedValue({ status: 200, data });
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA', motivo: 'CHAVE_INVALIDA' }); expect(p.client.get).toHaveBeenCalledTimes(1);
});
test.each([404, 500])('falha HTTP %s não autoriza retry/emissão', async status => {
  const p = cenario(); p.client.get.mockReset().mockRejectedValue({ response: { status } });
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA' }); expect(p.client.post).not.toHaveBeenCalled();
});
test('gzip expandido além de5MB é recusado', async () => {
  const p = cenario(nfse(inf.replace('Serviço teste', 'x'.repeat(5 * 1024 * 1024))));
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA' });
});
test('status cancelado no retorno bloqueia equivalência', async () => {
  const p = cenario(); p.client.get.mockReset().mockResolvedValueOnce({ status: 200, data: { chaveAcesso: chave } }).mockResolvedValueOnce({ status: 200, data: { status: 'cancelada', nfseXmlGZipB64: gzipSync(nfse(inf)).toString('base64') } });
  expect(await conciliarDps(p)).toMatchObject({ estado: 'INCONCLUSIVA' });
});

test.each([['<serie>1','<serie>2'],['<nDPS>1','<nDPS>2'],['<cStat>100','<cStat>102'],['<cStat>100</cStat>','']])('identidade numérica e status oficial exigidos: %s', async (a,b) => { expect(await conciliarDps(cenario(nfse(inf).replace(a,b)))).toMatchObject({estado:'INCONCLUSIVA'}); });
test.each(['tpAmb','tipoAmbiente'])('ambiente do envelope divergente bloqueia: %s', async campo => { const p=cenario(); p.client.get.mockReset().mockResolvedValue({status:200,data:{chaveAcesso:chave,[campo]:2}}); expect(await conciliarDps(p)).toMatchObject({estado:'INCONCLUSIVA',motivo:'AMBIENTE_ENVELOPE_DIVERGENTE'}); });
