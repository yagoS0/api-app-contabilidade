import { gzipSync } from 'node:zlib';
import { baixarNotasSelecionadas } from '../NotasSelecionadasService.js';
import { CHAVE_NFSE, CNPJ_DATAS, xmlNfseData, xmlResumoData } from '../../__fixtures__/dataEmissaoNotas.js';
const db = (rows, services = []) => ({
  portalClient: { findUnique: async () => ({ companyId: 'company', cnpj: CNPJ_DATAS }) },
  portalInvoice: { findMany: jest.fn(async () => rows) }, serviceInvoice: { findMany: jest.fn(async () => services) },
});
test.each(['XML', 'PDF'])('summary never becomes a complete %s, even with a civil date', async formato => {
  const client = db([{ id: 's', type: 'NFE', xmlRaw: null, xmlResumo: xmlResumoData(), dataEmissaoCivil: '2026-09-27' }]);
  const gerarNfe = jest.fn();
  await expect(baixarNotasSelecionadas({ portalClientId: 'a', notaIds: ['s'], formato, client, gerarNfe })).rejects.toMatchObject({ status: 422 });
  expect(gerarNfe).not.toHaveBeenCalled();
});
test.each([xmlNfseData(), Buffer.from(xmlNfseData()).toString('base64'), gzipSync(xmlNfseData()).toString('base64')])('ServiceInvoice envelope retains one validated source for XML download', async xml => {
  const client = db([], [{ id: 'si', xml, chaveAcesso: CHAVE_NFSE, numeroNfse: '1' }]);
  expect(await baixarNotasSelecionadas({ portalClientId: 'a', notaIds: ['si'], formato: 'XML', client })).toMatchObject({ geradas: 1, falhas: 0 });
  expect(client.serviceInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'company', id: { in: ['si'] } } }));
});
