jest.mock('../../../config.js', () => ({ ADN_CNPJ_CONSULTA: '', log: {} }));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { company: { findUnique: jest.fn() } } }));
jest.mock('../../../infrastructure/db/AdnRepository.js', () => ({ AdnRepository: {
  ensureState: jest.fn(), updateState: jest.fn(), upsertDocument: jest.fn(), updateByChaveAcesso: jest.fn(),
} }));
jest.mock('../../../infrastructure/storage/CertStorage.js', () => ({ readStoredCompanyPfx: jest.fn() }));
import { AdnSyncService } from '../AdnSyncService.js';
import { AdnRepository } from '../../../infrastructure/db/AdnRepository.js';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { readStoredCompanyPfx } from '../../../infrastructure/storage/CertStorage.js';

const A = '11111111000191', B = '22222222000191';
const documento = (nsu, cnpj) => ({ NSU: String(nsu), TipoDocumento: 'NFSE', ChaveAcesso: `fixture-${nsu}`,
  ArquivoXml: Buffer.from(`<NFSe><emit><CNPJ>${cnpj}</CNPJ></emit><nNFSe>${nsu}</nNFSe></NFSe>`).toString('base64') });
beforeEach(() => {
  jest.clearAllMocks();
  AdnRepository.ensureState.mockResolvedValue({ ultimoNSU: 0n });
  AdnRepository.upsertDocument.mockResolvedValue({ action: 'created' });
  jest.spyOn(AdnSyncService, 'fetchLote').mockRejectedValue(new Error('Transporte real proibido no ensaio'));
});
afterEach(() => jest.restoreAllMocks());

test('empresa/CNPJ divergentes bloqueiam antes de certificado, consulta e escrita', async () => {
  prisma.company.findUnique.mockResolvedValue({ cnpj: B });
  await expect(AdnSyncService.syncOnce({ companyId: 'fixture', cnpjConsulta: A }))
    .rejects.toMatchObject({ code: 'ADN_COMPANY_CNPJ_MISMATCH' });
  expect(readStoredCompanyPfx).not.toHaveBeenCalled();
  expect(AdnSyncService.fetchLote).not.toHaveBeenCalled();
  expect(AdnRepository.ensureState).not.toHaveBeenCalled();
});

test.each([['alheio', documento(1, B), 'ADN_DOCUMENTO_OUTRO_CNPJ'],
  ['sem identidade', { NSU: '1', TipoDocumento: 'NFSE' }, 'ADN_VINCULO_DOCUMENTAL_INCONCLUSIVO']])(
  '%s não persiste documento nem avança cursor', async (_, item, code) => {
    AdnSyncService.fetchLote.mockResolvedValue({ LoteDFe: [item] });
    await expect(AdnSyncService.syncOnce({ cnpjConsulta: A })).rejects.toMatchObject({ code });
    expect(AdnRepository.upsertDocument).not.toHaveBeenCalled();
    expect(AdnRepository.updateByChaveAcesso).not.toHaveBeenCalled();
    expect(AdnRepository.updateState).not.toHaveBeenCalled();
  });

test('lote fora de ordem preserva cursor legado e repassa identidade para cada escrita', async () => {
  AdnSyncService.fetchLote.mockResolvedValue({ LoteDFe: [documento(8, A), documento(3, A)] });
  expect(await AdnSyncService.syncOnce({ cnpjConsulta: A })).toMatchObject({ processed: 2, nextNSU: '9' });
  expect(AdnRepository.upsertDocument.mock.calls.map(([data, context]) => [data.nsu, context]))
    .toEqual([['8', { cnpjConsulta: A }], ['3', { cnpjConsulta: A }]]);
  expect(AdnRepository.updateState).toHaveBeenCalledWith(A, '9');
});

test('falha posterior preserva escritas válidas anteriores mas não marca lote concluído', async () => {
  AdnSyncService.fetchLote.mockResolvedValue({ LoteDFe: [documento(1, A), documento(2, B)] });
  await expect(AdnSyncService.syncOnce({ cnpjConsulta: A })).rejects.toMatchObject({ code: 'ADN_DOCUMENTO_OUTRO_CNPJ' });
  expect(AdnRepository.upsertDocument).toHaveBeenCalledTimes(1);
  expect(AdnRepository.updateState).not.toHaveBeenCalled();
});

test('lote vazio mantém resposta e cursor anteriores', async () => {
  AdnSyncService.fetchLote.mockResolvedValue({ StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO' });
  expect(await AdnSyncService.syncOnce({ cnpjConsulta: A })).toEqual({ status: 'NENHUM_DOCUMENTO_LOCALIZADO', processed: 0, nextNSU: '0' });
  expect(AdnRepository.upsertDocument).not.toHaveBeenCalled();
  expect(AdnRepository.updateState).not.toHaveBeenCalled();
});
