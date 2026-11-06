jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: {
  apuracaoSnapshot: { findUnique: jest.fn(async () => ({ id: 'snapshot', conferenciaStatus: 'ok', conferidaEm: new Date('2026-11-01'), conferenciaResultado: { faltantes: [], extras: [], adnTotal: 0 } })), updateMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => []), update: jest.fn() },
  portalClient: { findUnique: jest.fn(async () => ({ cnpj: '53742042000164' })) },
  portalInvoice: { findMany: jest.fn(async () => []), updateMany: jest.fn() },
} }));
jest.mock('../../application/fiscal/automacaoCicloFiscalContext.js', () => ({ comAutomacaoEmpresa: jest.fn(async (_id, run) => run()) }));
jest.mock('../../application/fiscal/serpro/CompanyRotinasService.js', () => ({ idsComRotinaAtiva: jest.fn(async () => new Set(['empresa-a'])) }));
jest.mock('../../application/fiscal/serpro/SerproRuntimeSettings.js', () => ({ getSerproRuntimeSettings: jest.fn() }));
jest.mock('../../application/guides/GuideLockService.js', () => ({ acquireGuideLease: jest.fn(async () => ({ assertActive() {}, release: jest.fn() })) }));
jest.mock('../../application/notas/CertResolver.js', () => ({ SERVICOS: { NFSE: 'NFSE' }, resolveCertForCompany: jest.fn(async () => ({ source: 'company_a1', pfxBuffer: Buffer.from('fake') })) }));
jest.mock('../../application/notas/adn-nacional/AdnNacionalClient.js', () => ({ fetchDfeNFSe: jest.fn() }));
jest.mock('../../config.js', () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import { runConferenciaAdnWorkerOnce } from '../conferenciaAdnWorker.js';
import { fetchDfeNFSe } from '../../application/notas/adn-nacional/AdnNacionalClient.js';
import { prisma } from '../../infrastructure/db/prisma.js';

test('worker registra falha da conferência real, sem sucesso e invalidando ok antigo', async () => {
  fetchDfeNFSe.mockResolvedValueOnce({ status: 'REJEICAO', items: [], errors: [{ Codigo: 'E0718', Descricao: 'segredo 12345678000199' }] });
  const timer = jest.spyOn(global, 'setTimeout').mockImplementation(fn => { queueMicrotask(fn); return 0; });
  try {
    const r = await runConferenciaAdnWorkerOnce({ competencia: '2026-10' });
    expect(r).toMatchObject({ ok: 0, falhas: 1, naoConferiveis: 0 });
    expect(r.results[0]).toMatchObject({ companyId: 'empresa-a', status: 'erro' });
    expect(r.results[0].reason).toContain('E0718');
    expect(JSON.stringify(r)).not.toMatch(/segredo|12345678000199/);
    expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
    expect(prisma.apuracaoSnapshot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conferenciaStatus: 'nao_conferivel', conferidaEm: null }) }));
    expect(prisma.portalInvoice.updateMany).not.toHaveBeenCalled();
  } finally { timer.mockRestore(); }
});