import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../application/guides/CicloEnvioGuiasService.js', () => ({ executarCicloEnvioGuias: jest.fn() }));
jest.mock('../runRoutineLoop.js', () => ({ runRoutineLoop: jest.fn() }));
import { comAutomacaoCicloFiscal, conferirContextoCicloFiscal } from '../../application/fiscal/automacaoCicloFiscalContext.js';
import { runRoutineLoop } from '../runRoutineLoop.js';
import { runSimplesEnvioGuiasWorkerOnce, runSimplesEnvioGuiasWorkerLoop } from '../simplesEnvioGuiasWorker.js';
const scheduledAt = '2026-11-08T10:00:00.000Z';
function fixture() {
  const settings = new Map();
  const db = {
    portalClient: { findUnique: jest.fn(async ({ where }) => ({ id: where.id })) },
    appSetting: {
      findUnique: jest.fn(async ({ where }) => settings.get(where.key) || null),
      findMany: jest.fn(async ({where}) => where.key.startsWith.startsWith('envio_guias_ciclo:') ? [] : [{ key: 'envio_guias_config:a', value: { enabled: true } }, { key: 'envio_guias_config:b', value: { enabled: false } }]),
    },
  };
  return { db, settings };
}
test('entrada direta não executa nem procura empresas sem reserva automática', async () => {
  const { db } = fixture(), executar = jest.fn();
  await expect(runSimplesEnvioGuiasWorkerOnce({ competencia: '2026-10', scheduledAt, assertActive() {} }, { db, executar })).rejects.toMatchObject({ code: 'CICLO_AGENDA_OBRIGATORIA' });
  expect(executar).not.toHaveBeenCalled(); expect(db.appSetting.findMany).not.toHaveBeenCalled();
});
test('seleção explícita e contexto empresarial chegam ao núcleo; empresa desligada não executa', async () => {
  const { db } = fixture();
  const executar = jest.fn(async args => { await conferirContextoCicloFiscal(db, { requireCompany: true, portalClientId: args.portalClientId }); return { status: 'CALCULADO' }; });
  const result = await comAutomacaoCicloFiscal({ version: 0, scheduledAt }, () => runSimplesEnvioGuiasWorkerOnce({ competencia: '2026-10', scheduledAt, assertActive() {} }, { db, executar }), db);
  expect(executar).toHaveBeenCalledTimes(1);
  expect(executar.mock.calls[0][0]).toMatchObject({ portalClientId: 'a', competencia: '2026-10', scheduledAt });
  expect(result).toMatchObject({ empresas: 1, failed: 0 });
});
test('pausa da empresa bloqueia o núcleo e retorna revisão sem repetir', async () => {
  const { db, settings } = fixture(), executar = jest.fn();
  settings.set('company_automation_policy:a', { value: { paused: true, version: 1, reason: 'Conferir', updatedAt: scheduledAt, updatedBy: 'admin', resumedAt: null } });
  const result = await comAutomacaoCicloFiscal({ version: 0, scheduledAt }, () => runSimplesEnvioGuiasWorkerOnce({ competencia: '2026-10', scheduledAt, assertActive() {} }, { db, executar }), db);
  expect(executar).not.toHaveBeenCalled(); expect(result.failed).toBe(1);
  expect(result.results[0].reason).toBe('AUTOMACAO_EMPRESA_PAUSADA');
});
test('loop usa apenas a agenda específica opt-in, sem worker amplo de notas', () => {
  runSimplesEnvioGuiasWorkerLoop();
  expect(runRoutineLoop).toHaveBeenCalledWith({ worker: 'SIMPLES_ENVIO_GUIAS_WORKER_ENABLED', routines: ['simples_envio_guias'], independent: true, run: runSimplesEnvioGuiasWorkerOnce });
});

test('novo tick visita ciclo anterior para complemento, sem recuperar slot antigo',async()=>{
 const {db}=fixture(); const configs=db.appSetting.findMany.getMockImplementation();
 db.appSetting.findMany.mockImplementation(args=>args.where.key.startsWith.startsWith('envio_guias_ciclo:')?[{value:{competencia:'2026-09'}},{value:{competencia:'2026-09'}},{value:{competencia:'2026-12'}}]:configs(args));
 const executar=jest.fn(async()=>({status:'WAIT'}));
 await comAutomacaoCicloFiscal({version:0,scheduledAt},()=>runSimplesEnvioGuiasWorkerOnce({competencia:'2026-10',scheduledAt,assertActive(){}},{db,executar}),db);
 expect(executar.mock.calls.map(c=>c[0].competencia)).toEqual(['2026-10','2026-09']);
 expect(executar.mock.calls.every(c=>c[0].scheduledAt===scheduledAt)).toBe(true);
});

test.each([['0','0'],['0','1'],['1','0'],['1','1']])('bootstrap real mantém coleta=%s e envio=%s independentes sem iniciar servidor',async(coleta,envio)=>{
 const source=readFileSync(path.resolve(__dirname,'../../server.js'),'utf8');
 const marker='// Opt-in explicito: publicar nao habilita coleta nem calculo.';
 expect(source.includes(marker)).toBe(true);
 const bootstrap=source.slice(source.indexOf(marker));
 const runColeta=jest.fn(async()=>{}),runEnvio=jest.fn(async()=>{});
 vm.runInNewContext(bootstrap,{process:{env:{SIMPLES_COLETA_CALCULO_WORKER_ENABLED:coleta,SIMPLES_ENVIO_GUIAS_WORKER_ENABLED:envio}},runSimplesColetaCalculoWorkerLoop:runColeta,runSimplesEnvioGuiasWorkerLoop:runEnvio,log:{error:jest.fn()}});
 expect(runColeta).toHaveBeenCalledTimes(coleta==='1'?1:0);expect(runEnvio).toHaveBeenCalledTimes(envio==='1'?1:0);
});
