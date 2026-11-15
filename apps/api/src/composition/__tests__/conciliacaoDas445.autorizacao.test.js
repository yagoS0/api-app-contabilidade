jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: {
  companyFirmAccess: { findUnique: jest.fn() },
  serproChamada: { findMany: jest.fn(async () => []) }, guide: { findMany: jest.fn(async () => []) },
  companyMonthlyCircular: { findUnique: jest.fn(async () => null) }, fiscalExecutionLog: { findMany: jest.fn(async () => []) },
  appSetting: { findMany: jest.fn(async () => []) }, accountingEntry: { findMany: jest.fn(async () => []) },
} }));
import { prisma } from '../../infrastructure/db/prisma.js';
import { consultarConciliacaoDas445Interna } from '../conciliacaoDas445.js';
const input = { companyId: 'empresa-a', competencia: '2026-10' };
beforeEach(() => { jest.clearAllMocks(); prisma.companyFirmAccess.findUnique.mockResolvedValue(null); });
test.each([undefined, { user: { id: 'u', role: 'accountant', accountType: 'FIRM' } }])('missing session or company link denies before evidence reads', async auth => {
  await expect(consultarConciliacaoDas445Interna(input, { auth })).rejects.toMatchObject({ code: 'ACESSO_NEGADO' });
  expect(prisma.serproChamada.findMany).not.toHaveBeenCalled(); expect(prisma.guide.findMany).not.toHaveBeenCalled();
  expect(prisma.appSetting.findMany).not.toHaveBeenCalled(); expect(prisma.companyMonthlyCircular.findUnique).not.toHaveBeenCalled();
});
test.each([{ role: 'STAFF', status: 'ACTIVE' }, { role: 'ACCOUNTANT', status: 'REVOKED' }])('canonical guard refuses %j', async link => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue(link);
  await expect(consultarConciliacaoDas445Interna(input, { auth: { user: { id: 'u', role: 'accountant', accountType: 'FIRM' } } })).rejects.toMatchObject({ code: 'ACESSO_NEGADO' });
  expect(prisma.guide.findMany).not.toHaveBeenCalled();
});
test('active company accountant is allowed and body actor cannot replace server session', async () => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE', scopes: [] });
  await consultarConciliacaoDas445Interna({ ...input, auth: { user: { id: 'forged', role: 'admin' } } }, { auth: { user: { id: 'real', role: 'accountant', accountType: 'FIRM' } } });
  expect(prisma.companyFirmAccess.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId_userId: { companyId: 'empresa-a', userId: 'real' } } }));
  expect(prisma.guide.findMany).toHaveBeenCalledTimes(1);
});
test('admin exception is the canonical existing policy; no global accountant exception', async () => {
  await consultarConciliacaoDas445Interna(input, { auth: { user: { id: 'u', role: 'admin' } } });
  expect(prisma.companyFirmAccess.findUnique).not.toHaveBeenCalled();
  expect(prisma.guide.findMany).toHaveBeenCalledTimes(1);
});
test('authorization read failure is fatal and not converted into an empty projection', async () => {
  prisma.companyFirmAccess.findUnique.mockRejectedValueOnce(Error('unavailable'));
  await expect(consultarConciliacaoDas445Interna(input, { auth: { user: { id: 'u', accountType: 'FIRM' } } })).rejects.toThrow('unavailable');
  expect(prisma.guide.findMany).not.toHaveBeenCalled();
});

test('CLIENT account cannot use office projection even with an active link', async () => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE' });
  await expect(consultarConciliacaoDas445Interna(input, { auth: { user: { id: 'client', role: 'accountant', accountType: 'CLIENT' } } })).rejects.toMatchObject({ code: 'ACESSO_NEGADO', status: 403 });
  expect(prisma.companyFirmAccess.findUnique).not.toHaveBeenCalled();
  expect(prisma.guide.findMany).not.toHaveBeenCalled();
});
test('inactive link cannot read company evidence', async () => {
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'INACTIVE' });
  await expect(consultarConciliacaoDas445Interna(input, { auth: { user: { id: 'u', role: 'accountant', accountType: 'FIRM' } } })).rejects.toMatchObject({ code: 'ACESSO_NEGADO' });
  expect(prisma.serproChamada.findMany).not.toHaveBeenCalled();
});
