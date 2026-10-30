import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import pdfParse from 'pdf-parse';
import { documentoNota, acoesDocumentoNota, gerarDanfeNfe } from '../DocumentoNotaService.js';
import { xmlParaDanfe } from './danfeFixture.js';
import { extrairDataEmissao } from '../../dataEmissaoNota.js';
import { xmlNfseData, CHAVE_NFSE, CNPJ_DATAS } from '../../__fixtures__/dataEmissaoNotas.js';
const xml = xmlParaDanfe(), evidence = extrairDataEmissao(xml);
const nota = { id: 'n1', type: 'NFE', xmlRaw: xml, chaveAcesso: evidence.identidade, emitenteDoc: evidence.emitenteDoc };
const hash = value => createHash('sha256').update(value).digest('hex');
function db(rows = [nota], services = [], cnpj = evidence.emitenteDoc) {
  return { portalClient: { findUnique: jest.fn(async () => ({ companyId: 'legada', cnpj })) },
    portalInvoice: { findMany: jest.fn(async () => rows) }, serviceInvoice: { findMany: jest.fn(async () => services) } };
}
const args = { portalClientId: 'a', notaId: 'n1' };
test('XML individual conserva hash e bytes completos sem depender de DTO/datas persistidas', async () => {
  const client = db();
  const out = await documentoNota({ ...args, formato: 'XML', client });
  expect(hash(out.conteudo)).toBe(hash(xml)); expect(out.mime).toBe('application/xml');
  expect(client.portalInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'a', id: { in: ['n1'] } } }));
});
test('PDF real e disponibilidade local; XML sem protocolo ainda pode ser baixado', async () => {
  expect((await documentoNota({ ...args, formato: 'PDF', client: db() })).conteudo.subarray(0, 5).toString()).toBe('%PDF-');
  const client = db([{ ...nota, xmlRaw: xml.replace(/<protNFe[\s\S]*?<\/protNFe>/, '') }]);
  expect(await acoesDocumentoNota({ ...args, client })).toMatchObject({ XML: { estado: 'disponivel' }, PDF: { estado: 'indisponivel' }, cancelar: { estado: 'indisponivel' } });
  expect((await documentoNota({ ...args, formato: 'XML', client })).conteudo.length).toBeGreaterThan(0);
});
test.each(['<resNFe/>', '<!DOCTYPE NFSe><NFSe/>', '<html>erro</html>'])('recusa documento incompleto/inseguro %s antes de gerar', async xmlRaw => {
  const gerarNfe = jest.fn();
  await expect(documentoNota({ ...args, formato: 'PDF', client: db([{ ...nota, xmlRaw }]), gerarNfe })).rejects.toMatchObject({ status: 422 });
  expect(gerarNfe).not.toHaveBeenCalled();
});
test('identidade PortalInvoice deve ser conferida antes do DANFSe', async () => {
  const gerarNfse = jest.fn();
  await expect(documentoNota({ ...args, formato: 'PDF', client: db([{ ...nota, type: 'NFSE', xmlRaw: xmlNfseData(), chaveAcesso: '1'.repeat(50) }], [], CNPJ_DATAS), gerarNfse })).rejects.toThrow('identidade');
  expect(gerarNfse).not.toHaveBeenCalled();
});
test('ServiceInvoice lê envelope apenas pela empresa legada e preserva XML', async () => {
  const original = '\n' + xmlNfseData() + '\n\n';
  const client = db([], [{ id: 'n1', xml: gzipSync(original).toString('base64'), chaveAcesso: CHAVE_NFSE }], CNPJ_DATAS);
  expect(hash((await documentoNota({ ...args, formato: 'XML', client })).conteudo)).toBe(hash(original));
  expect(client.serviceInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'legada', id: { in: ['n1'] } } }));
});
test('ServiceInvoice gera PDF sem existir detalhe PortalInvoice', async () => {
  const service = { id: 'n1', numeroNfse: '1', xml: gzipSync(xmlNfseData()).toString('base64'), chaveAcesso: CHAVE_NFSE, status: 'issued' };
  const client = db([], [service], CNPJ_DATAS);
  client.portalInvoice.findFirst = jest.fn(async () => null);
  client.serviceInvoice.findFirst = jest.fn(async () => service);
  const out = await documentoNota({ ...args, formato: 'PDF', client });
  expect(out.conteudo.subarray(0, 5).toString()).toBe('%PDF-');
  expect(client.serviceInvoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'n1', companyId: 'legada' } }));
}, 30000);
test('DPS é pedido e não documento autorizado', async () => {
  await expect(documentoNota({ ...args, formato: 'XML', client: db([], [{ id: 'n1', xml: '<DPS/>', chaveAcesso: CHAVE_NFSE }]) })).rejects.toMatchObject({ code: 'DANFSE_XML_E_O_PEDIDO' });
});
test('nota inexistente/fora da empresa tem a mesma recusa', async () => {
  await expect(documentoNota({ ...args, formato: 'XML', client: db([]) })).rejects.toMatchObject({ status: 404 });
});
test('não aceita JSON200 do gerador nem protocolo de outra nota', async () => {
  await expect(documentoNota({ ...args, formato: 'PDF', client: db(), gerarNfe: async () => Buffer.from('{"ok":true}') })).rejects.toMatchObject({ code: 'PDF_INVALIDO' });
  await expect(gerarDanfeNfe({ xml: xml.replace(/<chNFe>\d+/, '<chNFe>' + '1'.repeat(44)) })).rejects.toThrow('outra NF-e');
});
test('preserva recusa nomeada do QR sem fabricar PDF', async () => {
  const client = db([{ id: 'n1', type: 'NFSE', xmlRaw: xmlNfseData(), chaveAcesso: CHAVE_NFSE, emitenteDoc: CNPJ_DATAS }], [], CNPJ_DATAS);
  await expect(documentoNota({ ...args, formato: 'PDF', client, gerarNfse: async () => { throw Object.assign(new Error('QR ausente'), { code: 'DANFSE_SEM_QRCODE' }); } })).rejects.toMatchObject({ code: 'DANFSE_SEM_QRCODE' });
});

test.each(['CANCELADA', 'SUBSTITUIDA'])('DANFSe real conserva marca %s e não escreve estado', async marca => {
  const n = { id: 'n1', type: 'NFSE', numero: '1', xmlRaw: xmlNfseData(), chaveAcesso: CHAVE_NFSE, emitenteDoc: CNPJ_DATAS, statusEfetivo: 'cancelada' };
  const client = db([n], [], CNPJ_DATAS);
  client.portalInvoice.findFirst = jest.fn(async ({ where }) => where.id ? n : null);
  client.portalInvoiceEvent = { findMany: jest.fn(async () => marca === 'SUBSTITUIDA' ? [{ type: 'canc_por_substituicao', chaveSubstituta: '2'.repeat(50) }] : []) };
  const out = await documentoNota({ ...args, formato: 'PDF', client });
  expect(out.conteudo.subarray(0, 5).toString()).toBe('%PDF-');
  expect((await pdfParse(out.conteudo)).text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).toContain(marca);
  expect(client.portalInvoiceEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'a', invoiceId: 'n1' } }));
}, 30000);
