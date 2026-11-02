jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../application/guides/GuiaParcelaEnvioGuard.js', () => ({ conferirParcelasParaEnvio: jest.fn(), bloqueioEnvioParcela: jest.fn(), SELECT_PARCELA_ENVIO: {} }));
jest.mock('../../application/guides/EntregaExternaGuiaService.js', () => ({ reservarSemEntregaExterna: jest.fn((client, guides, run) => run(client)) }));
jest.mock('../../application/guides/GuideService.js', () => ({ getGuidePdfBuffer: jest.fn(async () => Buffer.from('pdf ficticio')) }));
jest.mock('../../application/guides/GuideLockService.js', () => ({ tryAcquireGuideLock: jest.fn(async () => true), releaseGuideLock: jest.fn() }));
jest.mock('../../application/guides/GuideScheduledEmailService.js', () => ({ SEM_DESTINATARIO_DE_GUIA: {}, resolveCompanyNotificationEmails: jest.fn(async () => ['teste@example.invalid']), validarDestinatariosAtuais: jest.fn() }));
jest.mock('../../infrastructure/mail/EmailService.js', () => ({ EmailService: jest.fn() }));
jest.mock('node:fs/promises', () => ({ mkdtemp: jest.fn(async () => 'ficticio'), writeFile: jest.fn(), unlink: jest.fn(), rm: jest.fn() }));
jest.mock('node:fs', () => ({ existsSync: jest.fn(() => false) }));
import { runScheduledRoutine, claimScheduledRun } from '../scheduledRoutineService.js';
import { conferirContextoCicloFiscal, comAutomacaoCicloFiscal } from '../../application/fiscal/automacaoCicloFiscalContext.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import { runGuideEmailWorkerOnce } from '../guideEmailWorker.js';
import { validarDestinatariosAtuais } from '../../application/guides/GuideScheduledEmailService.js';
import { EmailService } from '../../infrastructure/mail/EmailService.js';
const now = new Date('2026-11-01T10:00:05Z');
const config = { enabled: true, day: 1, hour: 7 };
const paused = { paused: true, version: 1, reason: 'Teste', actor: { id: 'u' }, changedAt: now.toISOString(), resumedAt: null };
function memoryDb() {
  const rows = new Map();
  return { rows, policy: null, appSetting: {
    findUnique: jest.fn(async function ({ where }) { return where.key === 'automacao_ciclo_fiscal' ? db.policy && { value: db.policy } : rows.get(where.key) || null; }),
    create: jest.fn(async ({ data }) => { rows.set(data.key, structuredClone(data)); return data; }),
    updateMany: jest.fn(async ({ where, data }) => { rows.set(where.key, { ...rows.get(where.key), ...data }); return { count: 1 }; }),
  } };
}
let db;
beforeEach(() => { jest.useFakeTimers().setSystemTime(now); db = memoryDb(); });
afterEach(() => jest.useRealTimers());
test('pausa e falha de leitura impedem reserva', async () => {
  db.policy = paused;
  await expect(claimScheduledRun({ routine: 'das', config, now, db })).rejects.toMatchObject({ code: 'CICLO_FISCAL_PAUSADO' });
  expect(db.appSetting.create).not.toHaveBeenCalled();
  db.appSetting.findUnique.mockRejectedValueOnce(new Error('offline'));
  await expect(claimScheduledRun({ routine: 'das', config, now, db })).rejects.toMatchObject({ code: 'CICLO_FISCAL_INDISPONIVEL' });
});
test('pausa durante reserva bloqueia chamada e conserva execução para conferência', async () => {
  const create = db.appSetting.create.getMockImplementation();
  db.appSetting.create.mockImplementation(async args => { await create(args); db.policy = paused; });
  const run = jest.fn();
  await expect(runScheduledRoutine('das', config, run, { db, now })).rejects.toMatchObject({ code: 'CICLO_FISCAL_PAUSADO' });
  expect(run).not.toHaveBeenCalled(); expect([...db.rows.values()][0].value.status).toBe('FAILED');
});
test('retorno iniciado antes da pausa persiste; nova etapa é bloqueada', async () => {
  await runScheduledRoutine('das', config, async () => {
    await conferirContextoCicloFiscal(); db.policy = paused;
    await expect(conferirContextoCicloFiscal()).rejects.toMatchObject({ code: 'CICLO_FISCAL_PAUSADO' });
    return { retorno: 'recebido' };
  }, { db, now });
  expect([...db.rows.values()][0].value).toMatchObject({ status: 'SUCCEEDED', result: { retorno: 'recebido' } });
});
test('retomada no mesmo minuto não recupera horário anterior', async () => {
  db.policy = { ...paused, paused: false, version: 2, resumedAt: now.toISOString() };
  await expect(claimScheduledRun({ routine: 'das', config, now, db })).rejects.toMatchObject({ code: 'CICLO_FISCAL_HORARIO_ANTERIOR' });
  expect(await claimScheduledRun({ routine: 'das', config, now: new Date('2026-12-01T10:00:05Z'), db })).not.toBeNull();
});

test.each(['pausa', 'rede'])('e-mail reservado: %s preserva histórico e só falha transitória agenda retry', async kind => {
  const guides = ['a', 'b'].map(portalClientId => ({ id: `g-${portalClientId}`, portalClientId, tipo: 'DAS', competencia: '2026-10', emailAttempts: 0, createdAt: now }));
  let companyPaused = false;
  prisma.appSetting = { findUnique: jest.fn(async ({ where }) => where.key === 'company_automation_policy:a' && companyPaused
    ? { value: { paused: true, version: 1, reason: 'Conferir', updatedBy: 'u', updatedAt: now.toISOString(), resumedAt: null } } : null) };
  prisma.portalClient = { findUnique: jest.fn(async ({ where }) => ({ id: where.id })) };
  prisma.guide = { findMany: jest.fn(async () => guides), update: jest.fn(async ({ where, data }) => ({ ...guides.find(g => g.id === where.id), ...data })) };
  const send = jest.fn(async () => undefined);
  EmailService.mockImplementation(() => ({ send }));
  validarDestinatariosAtuais.mockImplementation(async id => {
    if (id !== 'a') return;
    if (kind === 'pausa') companyPaused = true;
    else throw Object.assign(new Error('Falha transitória'), { code: 'EMAIL_NETWORK' });
  });
  const result = await comAutomacaoCicloFiscal({ version: 0 }, () => runGuideEmailWorkerOnce(), prisma);
  expect(result.results[0]).toMatchObject({ guideId: 'g-a', status: 'ERROR', attempts: 1,
    code: kind === 'pausa' ? 'AUTOMACAO_EMPRESA_PAUSADA' : 'EMAIL_NETWORK', willRetry: kind === 'rede' });
  expect(prisma.guide.update).toHaveBeenCalledWith({ where: { id: 'g-a' }, data: {
    emailStatus: 'SENDING', emailAttempts: 1, emailLastError: null, emailNextRetryAt: null,
  } });
  expect(prisma.guide.update).toHaveBeenCalledWith({ where: { id: 'g-a' }, data: expect.objectContaining({
    emailStatus: 'ERROR', emailNextRetryAt: kind === 'pausa' ? null : expect.any(Date),
  }) });
  expect(result.results[1]).toMatchObject({ guideId: 'g-b', status: 'SENT' });
  expect(send).toHaveBeenCalledTimes(1);
  expect(prisma.guide.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'g-a' }, data: expect.objectContaining({ emailStatus: 'SENT' }) }));
});
