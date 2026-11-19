const mockPost = jest.fn();
const mockPersistir = jest.fn(async () => ({ guide: { id: 'g' }, now: new Date() }));
const mockContabilizar = jest.fn(async () => ({ circular: null, accounting: { somenteDocumentos: true } }));
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: { portalClient: { findUnique: jest.fn(async () => ({ id: 'p', cnpj: '12345678000199' })) }, guide: { deleteMany: jest.fn() } } }));
jest.mock('../SerproPgdasdService.js', () => ({ SERPRO_PGDASD_SERVICE_NORMAL: 'GERARDAS12', SERPRO_PGDASD_SERVICE_COBRANCA: 'GERARDASCOBRANCA17', SerproPgdasdService: jest.fn(() => ({ emitirDasNormal: (...a) => mockPost(...a), emitirDasCobranca: (...a) => mockPost(...a) })) }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: '99999999000199' } })) }));
jest.mock('../../../../composition/persistenciaDocumentoDas.js', () => ({ persistirDocumentoDasComGuias: (...a) => mockPersistir(...a) }));
jest.mock('../../../../composition/contabilidadeDasCapturado.js', () => ({ contabilizarDasCapturadoComLegado: (...a) => mockContabilizar(...a) }));
jest.mock('../../../guides/GuideService.js', () => ({ toGuideResponse: x => x, PUBLICO: { ESCRITORIO: 'ESCRITORIO' } }));
jest.mock('../reutilizarGuia.js', () => ({ reutilizarGuia: jest.fn(async () => null) }));
jest.mock('../../../../modules/fiscal/infrastructure/documentos/lerTextoPdfDas.js', () => ({ lerTextoPdfDas: jest.fn(async () => 'Valor Total do Documento 150,00') }));
import { capturePgdasGuideForCompany } from '../CaptureSerproGuidesService.js';
import { lerTextoPdfDas } from '../../../../modules/fiscal/infrastructure/documentos/lerTextoPdfDas.js';
const cnpj = '12345678000199';
const bytes = Buffer.from('%PDF-1.4\n' + 'synthetic '.repeat(20));
const entrada = { portalClientId: 'p', competencia: '2026-10', somenteDocumentos: true, validacaoDocumental: { numeroDeclaracao: 'decl', autorizar: async () => {} } };
const resposta = detalhe => ({ status: 200, contratante: { numero: '99999999000199' }, dados: JSON.stringify({ detalhamentoDas: { cnpj, periodoApuracao: '202610', numeroDocumento: '123', dataVencimento: '20261120', ...detalhe }, pdf: bytes.toString('base64') }) });
beforeEach(() => { jest.clearAllMocks(); mockPost.mockResolvedValue(resposta({ valorTotalDocumento: 100 })); });
test.each([{ cnpj: '00000000000100' }, { periodoApuracao: '202611' }, { numeroDeclaracao: 'outra' }])('eco aninhado divergente impede escrita %j', async detalhe => {
  mockPost.mockResolvedValue(resposta(detalhe));
  await expect(capturePgdasGuideForCompany(entrada)).rejects.toThrow(); expect(mockPersistir).not.toHaveBeenCalled(); expect(mockContabilizar).not.toHaveBeenCalled();
});
test('intérprete e fallback reais preservam valor PDF e ignoram CNPJ contratante', async () => {
  mockPost.mockResolvedValue(resposta({})); await capturePgdasGuideForCompany(entrada);
  expect(lerTextoPdfDas).toHaveBeenCalled();
  expect(mockPersistir).toHaveBeenCalledWith(expect.objectContaining({ mapped: expect.objectContaining({ pgdasNumeroDeclaracao: 'decl', numeroDocumento: '123', parsed: expect.objectContaining({ valor: 150 }) }) }));
});
test.each(['20260230', '30/02/2026', '2026-02-30'])('data inexistente não aceita rollover do parser: %s', async dataVencimento => {
  mockPost.mockResolvedValue(resposta({ dataVencimento, valorTotalDocumento: 100 }));
  await expect(capturePgdasGuideForCompany(entrada)).rejects.toThrow(); expect(mockPersistir).not.toHaveBeenCalled();
});
test('bytes não PDF não chegam à persistência', async () => {
  const raw = resposta({ valorTotalDocumento: 100 }); const dados = JSON.parse(raw.dados); dados.pdf = Buffer.from('not-pdf'.repeat(30)).toString('base64'); raw.dados = JSON.stringify(dados); mockPost.mockResolvedValue(raw);
  await expect(capturePgdasGuideForCompany(entrada)).rejects.toThrow(); expect(mockPersistir).not.toHaveBeenCalled();
});
test('erro do provedor não é neutralizado pela presença do PDF', async () => {
  mockPost.mockResolvedValue({ ...resposta({ valorTotalDocumento: 100 }), mensagens: [{ codigo: '[Erro-PGDASD]', texto: 'fixture' }] });
  await expect(capturePgdasGuideForCompany(entrada)).rejects.toThrow(); expect(mockPersistir).not.toHaveBeenCalled();
});
