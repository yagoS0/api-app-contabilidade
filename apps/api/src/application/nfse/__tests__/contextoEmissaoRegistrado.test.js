jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { contextoEmissaoRegistrado } from '../contextoEmissaoRegistrado.js';
const nota = { type: 'NFSE', papel: 'EMIT', chaveAcesso: 'chave', idDps: 'dps' };
test('lê snapshot pela chave e empresa autorizada, sem consultar perfil atual', async () => {
  const configuracaoFiscal = { regimeVigente: { regime: 'SIMPLES' }, perfil: { codigoNbs: '1.1406.11.00' } };
  const db = { portalClient: { findUnique: jest.fn(async () => ({ companyId: 'legado' })) },
    serviceInvoice: { findMany: jest.fn(async () => [{ configuracaoFiscal }]) } };
  expect(await contextoEmissaoRegistrado(nota, 'portal', db)).toEqual({ estado: 'REGISTRADO_NA_EMISSAO', configuracao: configuracaoFiscal });
  expect(db.serviceInvoice.findMany).toHaveBeenCalledWith({ where: { companyId: 'legado', chaveAcesso: 'chave' }, select: { configuracaoFiscal: true }, take: 2 });
});
test.each([[[], 'SEM_REGISTRO'], [[{}, {}], 'VINCULO_AMBIGUO']])('ausência ou ambiguidade não reconstrói passado', async (registros, estado) => {
  const db = { portalClient: { findUnique: async () => ({ companyId: 'legado' }) }, serviceInvoice: { findMany: async () => registros } };
  expect(await contextoEmissaoRegistrado(nota, 'portal', db)).toEqual({ estado });
});
test('nota recebida não procura emissão local; falha aparece como indisponível', async () => {
  expect(await contextoEmissaoRegistrado({ ...nota, papel: 'DEST' }, 'portal', {})).toBeNull();
  expect(await contextoEmissaoRegistrado(nota, 'portal', {})).toEqual({ estado: 'INDISPONIVEL' });
});
