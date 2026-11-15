jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: {
  companyFirmAccess: { findUnique: jest.fn() },
  serproChamada: { findMany: jest.fn(async () => []) }, guide: { findMany: jest.fn(async () => []) },
  companyMonthlyCircular: { findUnique: jest.fn(async () => null) }, fiscalExecutionLog: { findMany: jest.fn(async () => []) },
  appSetting: { findMany: jest.fn(async () => []) }, accountingEntry: { findMany: jest.fn(async () => []) },
} }));
import { prisma } from '../../infrastructure/db/prisma.js';
import { avaliarElegibilidadeRecuperacaoDas448 } from '../previaRecuperacaoDas448.js';
const input = { companyId: 'empresa', competencia: '2026-10', servico: 'GERARDAS12' };
const auth = { user: { id: 'contador', accountType: 'FIRM', role: 'accountant' } };
beforeEach(() => { jest.clearAllMocks(); prisma.companyFirmAccess.findUnique.mockResolvedValue(null); });
test.each([undefined, auth, { user: { ...auth.user, accountType: 'CLIENT' } }])('sessão/empresa não autorizada recusa todas as fontes', async session => {
  await expect(avaliarElegibilidadeRecuperacaoDas448(input, { auth: session })).rejects.toMatchObject({ code: 'ACESSO_NEGADO' });
  expect(prisma.serproChamada.findMany).not.toHaveBeenCalled(); expect(prisma.appSetting.findMany).not.toHaveBeenCalled(); expect(prisma.guide.findMany).not.toHaveBeenCalled();
});
test.each([{ role: 'STAFF', status: 'ACTIVE' }, { role: 'ACCOUNTANT', status: 'REVOKED' }])('preserva #275: %j', async link => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue(link);
  await expect(avaliarElegibilidadeRecuperacaoDas448(input, { auth })).rejects.toMatchObject({ code: 'ACESSO_NEGADO' });
});
test('auth forjada na entrada é recusada', async () => {
  await expect(avaliarElegibilidadeRecuperacaoDas448({ ...input, auth }, {})).rejects.toMatchObject({ code: 'ENTRADA_INVALIDA' });
});
test('exceção admin preservada e documento fora do escopo indistinguível de ausente', async () => {
  const server = { auth: { user: { id: 'admin', role: 'admin' } } };
  const a = await avaliarElegibilidadeRecuperacaoDas448({ ...input, documentoId: 'outra-empresa' }, server);
  const b = await avaliarElegibilidadeRecuperacaoDas448({ ...input, documentoId: 'inexistente' }, server);
  expect(a.classificacao).toBe(b.classificacao); expect(a.lacunas).toEqual(b.lacunas); expect(a.evidencias.map(o => ({ ...o, consultadoEm: null }))).toEqual(b.evidencias.map(o => ({ ...o, consultadoEm: null })));
  expect(prisma.companyFirmAccess.findUnique).not.toHaveBeenCalled();
});
test('revogação antes da segunda observação impede novas leituras', async () => {
  prisma.companyFirmAccess.findUnique.mockResolvedValueOnce({ role: 'ACCOUNTANT', status: 'ACTIVE' }).mockResolvedValueOnce({ role: 'ACCOUNTANT', status: 'ACTIVE' }).mockResolvedValue(null);
  await expect(avaliarElegibilidadeRecuperacaoDas448(input, { auth })).rejects.toMatchObject({ code: 'ACESSO_NEGADO' });
  expect(prisma.serproChamada.findMany).toHaveBeenCalledTimes(1);
});
