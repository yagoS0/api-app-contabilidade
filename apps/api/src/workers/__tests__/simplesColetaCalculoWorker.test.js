jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../application/notas/apuracao/v2/CicloSimplesService.js', () => ({ executarCicloSimples: jest.fn() }));
jest.mock('../runRoutineLoop.js', () => ({ runRoutineLoop: jest.fn() }));
import { comAutomacaoCicloFiscal, conferirContextoCicloFiscal } from '../../application/fiscal/automacaoCicloFiscalContext.js';
import { runRoutineLoop } from '../runRoutineLoop.js';
import { runSimplesColetaCalculoWorkerOnce, runSimplesColetaCalculoWorkerLoop } from '../simplesColetaCalculoWorker.js';
const scheduledAt = '2026-11-08T10:00:00.000Z';
function fixture() {
  const settings = new Map();
  const db = {
    portalClient: { findUnique: jest.fn(async ({ where }) => ({ id: where.id })) },
    appSetting: {
      findUnique: jest.fn(async ({ where }) => settings.get(where.key) || null),
      findMany: jest.fn(async () => [{ key: 'ciclo_simples_config:a', value: { enabled: true } }, { key: 'ciclo_simples_config:b', value: { enabled: false } }]),
    },
  };
  return { db, settings };
}
test('entrada direta não executa nem procura empresas sem reserva automática', async () => {
  const { db } = fixture(), executar = jest.fn();
  await expect(runSimplesColetaCalculoWorkerOnce({ competencia: '2026-10', scheduledAt, assertActive() {} }, { db, executar })).rejects.toMatchObject({ code: 'CICLO_AGENDA_OBRIGATORIA' });
  expect(executar).not.toHaveBeenCalled(); expect(db.appSetting.findMany).not.toHaveBeenCalled();
});
test('seleção explícita e contexto empresarial chegam ao núcleo; empresa desligada não executa', async () => {
  const { db } = fixture();
  const executar = jest.fn(async args => { await conferirContextoCicloFiscal(db, { requireCompany: true, portalClientId: args.portalClientId }); return { status: 'CALCULADO' }; });
  const result = await comAutomacaoCicloFiscal({ version: 0, scheduledAt }, () => runSimplesColetaCalculoWorkerOnce({ competencia: '2026-10', scheduledAt, assertActive() {} }, { db, executar }), db);
  expect(executar).toHaveBeenCalledTimes(1);
  expect(executar.mock.calls[0][0]).toMatchObject({ portalClientId: 'a', competencia: '2026-10', scheduledAt });
  expect(result).toMatchObject({ empresas: 1, failed: 0 });
});
test('pausa da empresa bloqueia o núcleo e retorna revisão sem repetir', async () => {
  const { db, settings } = fixture(), executar = jest.fn();
  settings.set('company_automation_policy:a', { value: { paused: true, version: 1, reason: 'Conferir', updatedAt: scheduledAt, updatedBy: 'admin', resumedAt: null } });
  const result = await comAutomacaoCicloFiscal({ version: 0, scheduledAt }, () => runSimplesColetaCalculoWorkerOnce({ competencia: '2026-10', scheduledAt, assertActive() {} }, { db, executar }), db);
  expect(executar).not.toHaveBeenCalled(); expect(result.failed).toBe(1);
  expect(result.results[0].reason).toBe('AUTOMACAO_EMPRESA_PAUSADA');
});
test('loop usa apenas a agenda específica opt-in, sem worker amplo de notas', () => {
  runSimplesColetaCalculoWorkerLoop();
  expect(runRoutineLoop).toHaveBeenCalledWith({ worker: 'SIMPLES_COLETA_CALCULO_WORKER_ENABLED', routines: ['simples_coleta_calculo'], independent: true, run: runSimplesColetaCalculoWorkerOnce });
});
