// Serviço, assinatura e DANFSe reais; Prisma, configuração, A1 e HTTP sintéticos.
// Não valida XSD, confiança ICP-Brasil, mTLS ou autorização HTTP.
jest.mock('../../../config.js', () => ({
  NFSE_ENV: 'homolog', NFSE_BASE_URL: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
  NFSE_PATH: '/nfse', NFSE_CONSULT_PATH: '/nfse/consulta', NFSE_DPS_PATH: '/dps', NFSE_NFSE_PATH: '/nfse',
  INTEGRACAO_PERFIL_EMISSAO_NFSE: false, INTEGRACAO_NFSE_IBSCBS: false,
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('axios', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../nfseCertificado.js', () => ({ resolverCertificadosDaEmpresa: jest.fn() }));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  company: { findUnique: jest.fn() }, portalClient: { findUnique: jest.fn() },
  portalInvoice: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() }, cadastroFiscal: { findUnique: jest.fn() },
  companyMonthlyCircular: { findFirst: jest.fn() }, apuracaoSnapshot: { findUnique: jest.fn() }, apuracao: { findUnique: jest.fn() },
  serviceInvoice: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() }, $transaction: jest.fn(),
} }));
import { generateKeyPairSync } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { gunzipSync, gzipSync } from 'node:zlib';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import pdfParse from 'pdf-parse';
import axios from 'axios';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { log } from '../../../config.js';
import { resolverCertificadosDaEmpresa } from '../nfseCertificado.js';
import { NfseService } from '../NfseService.js';
import { gerarDanfseDaNota } from '../danfse/danfseDaNotaDoPortal.js';
import { CONTRATO_NACIONAL } from '../contratoNacional.js';
import { lerEnvelopeXml } from '../lerEnvelopeXml.js';

jest.setTimeout(30000);
const EMPRESA = {
  id: 'empresa-sintetica', cnpj: '11222333000181', inscricaoMunicipal: '12345',
  codigoServicoNacional: '171201', codigoServicoMunicipal: '001', rpsSerie: '1', rpsNumero: '41',
  codigoMunicipioIbge: '3304557', regimeTributario: 'SIMPLES_NACIONAL',
  regimeHistorico: [{ id: 'vigencia-sintetica', regime: 'SIMPLES', vigenciaInicio: '2020-01-01', vigenciaFim: null }],
};
const PEDIDO = {
  companyId: EMPRESA.id, competencia: '2026-11-22',
  tomador: { doc: '52998224725', nome: 'TOMADOR SINTETICO',
    endereco: { cMun: '3304557', CEP: '20000000', xLgr: 'RUA SINTETICA', nro: '1', xBairro: 'CENTRO' } },
  servico: { descricao: 'SERVICO SINTETICO SEM VALIDADE FISCAL', valorServicos: 100, aliquota: 5, issRetido: false },
  totTrib: { pTotTribSN: 6 },
};
const CHAVE = '3'.repeat(50);
let certificado, publicKey, post, get, registro, xmlOficial, reserva, socket, tlsConnect;
const emitir = extra => NfseService.issue({ data: structuredClone(PEDIDO), log, ...extra });
const descompactar = body => gunzipSync(Buffer.from(body.dpsXmlGZipB64, 'base64')).toString('utf8');
const lerDocumento = (portalClientId = 'portal-sintetico') => gerarDanfseDaNota({ portalClientId, notaId: registro.id, client: prisma });
const respostaXml = xml => `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${CHAVE}"><nNFSe>18</nNFSe><dhProc>2026-11-22T12:00:00-03:00</dhProc><cStat>100</cStat>${xml.slice(xml.indexOf('<DPS'))}</infNFSe></NFSe>`;

beforeAll(() => {
  const bloquear = () => { throw new Error('REDE_REAL_PROIBIDA_NESTE_TESTE'); };
  socket = jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(bloquear);
  tlsConnect = jest.spyOn(tls, 'connect').mockImplementation(bloquear);
  // Material efêmero, criado em memória; nenhum arquivo/certificado existente.
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  publicKey = keys.publicKey;
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01'); cert.validity.notAfter = new Date('2027-01-01');
  cert.setSubject([{ name: 'commonName', value: 'FIXTURE SEM VALIDADE FISCAL' }]);
  cert.setIssuer(cert.subject.attributes);
  cert.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create());
  certificado = {
    assinatura: { keyPem: keys.privateKey, certBase64: forge.pki.certificateToPem(cert).replace(/-----[^-]+-----|\s/g, '') },
    transporte: { pfxBuffer: Buffer.from('PFX FICTICIO NUNCA USADO'), password: 'fixture' }, origem: 'company_a1',
  };
});
afterAll(() => { socket.mockRestore(); tlsConnect.mockRestore(); });
beforeEach(() => {
  jest.clearAllMocks(); registro = null; xmlOficial = null;
  prisma.company.findUnique.mockResolvedValue(structuredClone(EMPRESA));
  prisma.portalClient.findUnique.mockImplementation(async ({ where }) => where.id === 'outro-portal'
    ? { id: where.id, companyId: 'outra-empresa', cnpj: '11444777000161' }
    : { id: 'portal-sintetico', companyId: EMPRESA.id, cnpj: EMPRESA.cnpj });
  prisma.portalInvoice.findMany.mockResolvedValue([]);
  prisma.portalInvoice.findFirst.mockResolvedValue(null);
  prisma.cadastroFiscal.findUnique.mockResolvedValue(null);
  prisma.companyMonthlyCircular.findFirst.mockResolvedValue(null);
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
  prisma.apuracao.findUnique.mockResolvedValue(null);
  prisma.serviceInvoice.create.mockImplementation(async ({ data }) => {
    registro = { id: 'tentativa-sintetica', updatedAt: new Date('2026-11-22T12:00:00Z'), ...data }; return { ...registro };
  });
  prisma.serviceInvoice.update.mockImplementation(async ({ where, data }) => {
    if (where.id !== registro?.id) throw new Error('Tentativa desconhecida');
    Object.assign(registro, data); return { ...registro };
  });
  prisma.serviceInvoice.findUnique.mockImplementation(async ({ where }) => where.id === registro?.id ? { ...registro } : null);
  prisma.serviceInvoice.findFirst.mockImplementation(async ({ where }) => registro &&
    Object.entries(where).every(([key, value]) => registro[key] === value) ? { ...registro } : null);
  // Modela apenas o CAS do serviço; concorrência SQL pertence à suíte PostgreSQL.
  prisma.serviceInvoice.updateMany.mockImplementation(async ({ where, data }) => {
    if (!registro || where.id !== registro.id || where.companyId !== registro.companyId
      || where.status !== registro.status || where.updatedAt !== registro.updatedAt
      || JSON.stringify(where.configuracaoFiscal.equals) !== JSON.stringify(registro.configuracaoFiscal)) return { count: 0 };
    Object.assign(registro, data); return { count: 1 };
  });
  reserva = jest.fn(async () => [{ rpsNumero: '42' }]);
  prisma.$transaction.mockImplementation(async executar => executar({ serviceInvoice: prisma.serviceInvoice, $queryRaw: reserva }));
  resolverCertificadosDaEmpresa.mockResolvedValue(certificado);
  post = jest.fn(async (url, body) => {
    expect(url).toBe('/nfse');
    const xml = descompactar(body);
    expect(registro).toMatchObject({ companyId: EMPRESA.id, rpsNumero: '42', xmlDps: xml, contratoEmissao: CONTRATO_NACIONAL.id });
    xmlOficial = respostaXml(xml);
    return { data: { chaveAcesso: CHAVE, nfseXmlGZipB64: gzipSync(xmlOficial).toString('base64') } };
  });
  get = jest.fn(async url => {
    if (url !== `/nfse/${CHAVE}`) throw new Error(`Consulta inesperada: ${url}`);
    return { data: { chaveAcesso: CHAVE, nfseXmlGZipB64: gzipSync(xmlOficial).toString('base64') } };
  });
  axios.create.mockReturnValue({ defaults: { baseURL: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional' }, post, get });
});
afterEach(() => { expect(socket).not.toHaveBeenCalled(); expect(tlsConnect).not.toHaveBeenCalled(); });

test('cadastro → assinatura → resposta → consulta → DANFSe conserva a operação sintética', async () => {
  const autorizar = jest.fn(async () => {});
  const resultado = await emitir({ autorizarEnvioFinal: autorizar });
  expect(resultado).toMatchObject({ status: 'issued', nfse: { companyId: EMPRESA.id, numeroNfse: '18', chaveAcesso: CHAVE, xml: xmlOficial } });
  expect(autorizar).toHaveBeenCalledWith('tentativa-sintetica');
  expect(autorizar.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
  expect(resolverCertificadosDaEmpresa).toHaveBeenCalledWith(EMPRESA.id);
  expect(reserva).toHaveBeenCalledTimes(1);
  const xml = descompactar(post.mock.calls[0][1]);
  for (const trecho of ['<tpAmb>2</tpAmb>', '<dCompet>2026-11-22</dCompet>', '<cLocEmi>3304557</cLocEmi>', '<cTribNac>171201</cTribNac>', '<opSimpNac>3</opSimpNac>', '<tpRetISSQN>1</tpRetISSQN>', '<nDPS>42</nDPS>']) expect(xml).toContain(trecho);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const verificador = new SignedXml();
  verificador.keyInfoProvider = { getKey: () => publicKey };
  verificador.loadSignature(doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0]);
  expect(verificador.checkSignature(xml)).toBe(true);
  expect(xml).toContain('<vServ>100.00</vServ>');
  expect(verificador.checkSignature(xml.replace('<vServ>100.00</vServ>', '<vServ>101.00</vServ>'))).toBe(false);
  expect(await NfseService.syncFromProvider({ companyId: EMPRESA.id, filters: { chaveAcesso: CHAVE }, log }))
    .toEqual({ total: 1, created: 0, updated: 1, skipped: 0 });
  expect(prisma.serviceInvoice.findFirst).toHaveBeenCalledWith({ where: { companyId: EMPRESA.id, chaveAcesso: CHAVE } });
  expect(lerEnvelopeXml(registro.xml)).toEqual({ forma: 'GZIP_B64', xml: xmlOficial });
  expect(post).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1);
  expect(prisma.serviceInvoice.create).toHaveBeenCalledTimes(1);
  const { pdf, conformidade } = await lerDocumento();
  const lido = await pdfParse(pdf);
  expect(conformidade.paginas).toBe(1);
  expect(lido.text).toContain(PEDIDO.servico.descricao);
  expect(lido.text).toContain(PEDIDO.tomador.nome);
  expect(lido.text.replace(/\s+/g, ' ')).toContain('SEM VALIDADE JURÍDICA');
  expect(prisma.portalInvoice.create).not.toHaveBeenCalled();
});
test('pré-validação sem percentual explícito não reserva nem transmite', async () => {
  expect((await emitir({ data: { ...structuredClone(PEDIDO), totTrib: {} } })).codigo).toBe('MISSING_P_TOT_TRIB_SN');
  expect(prisma.$transaction).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
test('revogação na última guarda impede POST depois da preparação', async () => {
  const guarda = jest.fn(async () => { throw Object.assign(new Error('Revogado sintético'), { code: 'ACESSO_REVOGADO' }); });
  const result = await emitir({ autorizarEnvioFinal: guarda });
  expect(guarda).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ codigo: 'ACESSO_REVOGADO' }); expect(registro.xmlDps).toContain('<Signature');
  expect(post).not.toHaveBeenCalled();
});
test.each(['timeout', 'resposta incompleta'])('%s preserva XML e bloqueia retry sem nova numeração', async tipo => {
  if (tipo === 'timeout') post.mockRejectedValueOnce(Object.assign(new Error('timeout sintético'), { code: 'ETIMEDOUT' }));
  else post.mockResolvedValueOnce({ data: { chaveAcesso: CHAVE } });
  expect(await emitir()).toMatchObject({ camada: 'TRANSPORTE', numeroReutilizavel: false });
  expect(registro.xmlDps).toContain('<Signature'); expect(registro.status).not.toBe('issued');
  await expect(emitir({ retryInvoiceId: registro.id })).rejects.toMatchObject({ code: 'NFSE_NUMERO_EM_ESTADO_INDETERMINADO' });
  expect(post).toHaveBeenCalledTimes(1); expect(reserva).toHaveBeenCalledTimes(1);
  expect(prisma.serviceInvoice.create).toHaveBeenCalledTimes(1);
});

test('timeout → consulta MESMA → DANFSe recupera sem retransmitir', async () => {
  post.mockImplementationOnce(async (_url, body) => {
    xmlOficial = respostaXml(descompactar(body));
    throw Object.assign(new Error('Resposta perdida sintética'), { code: 'ETIMEDOUT' });
  });
  expect(await emitir()).toMatchObject({ camada: 'TRANSPORTE', numeroReutilizavel: false });
  get.mockImplementation(async url => {
    if (url === `/dps/${registro.idDps}`) return { status: 200, data: { chaveAcesso: CHAVE } };
    if (url === `/nfse/${CHAVE}`) return { status: 200, data: { nfseXmlGZipB64: gzipSync(xmlOficial).toString('base64') } };
    if (url.endsWith(`/${CHAVE}/Eventos`)) return { status: 200, data: { TipoAmbiente: 2, StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [] } };
    throw Error('Consulta não prevista');
  });
  expect(await NfseService.conciliarTentativa({ companyId: EMPRESA.id, invoiceId: registro.id }))
    .toMatchObject({ estado: 'MESMA', recuperada: true });
  expect(registro).toMatchObject({ status: 'issued', numeroNfse: '18', chaveAcesso: CHAVE });
  expect((await pdfParse((await lerDocumento()).pdf)).text).toContain(PEDIDO.servico.descricao);
  expect(get).toHaveBeenCalledTimes(3); expect(post).toHaveBeenCalledTimes(1);
  expect(reserva).toHaveBeenCalledTimes(1); expect(prisma.serviceInvoice.create).toHaveBeenCalledTimes(1);
  expect(prisma.portalInvoice.create).not.toHaveBeenCalled();
});

test('outra empresa não recupera a tentativa nem seu DANFSe', async () => {
  await emitir(); jest.clearAllMocks();
  await expect(lerDocumento('outro-portal')).rejects.toMatchObject({ code: 'DANFSE_NOTA_NAO_ENCONTRADA' });
  await expect(NfseService.conciliarTentativa({ companyId: 'outra-empresa', invoiceId: registro.id }))
    .rejects.toMatchObject({ code: 'NFSE_RETRY_INVOICE_NOT_FOUND' });
  expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  expect(resolverCertificadosDaEmpresa).not.toHaveBeenCalled();
  expect(prisma.serviceInvoice.update).not.toHaveBeenCalled();
});

test('XML com identidade divergente não é entregue como DANFSe', async () => {
  await emitir();
  registro.xml = xmlOficial.replace(`NFS${CHAVE}`, `NFS${'4'.repeat(50)}`);
  jest.clearAllMocks();
  await expect(lerDocumento()).rejects.toMatchObject({ code: 'DANFSE_XML_INDISPONIVEL' });
  expect(post).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  expect(prisma.serviceInvoice.update).not.toHaveBeenCalled();
});

test('sem histórico de regime não inicia tentativa ou transporte', async () => {
  prisma.company.findUnique.mockResolvedValue({ ...EMPRESA, regimeHistorico: [] });
  expect(await emitir()).toMatchObject({ codigo: 'NFSE_REGIME_SEM_VIGENCIA', camada: 'NOSSA' });
  expect(reserva).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
});
