import { prisma } from '../infrastructure/db/prisma.js';
import { executarCicloEnvioGuias } from '../application/guides/CicloEnvioGuiasService.js';
import { comAutomacaoEmpresa, conferirContextoCicloFiscal } from '../application/fiscal/automacaoCicloFiscalContext.js';
import { runRoutineLoop } from './runRoutineLoop.js';

export async function runSimplesEnvioGuiasWorkerOnce({ competencia, scheduledAt, assertActive } = {}, dependencies = {}) {
  const db = dependencies.db || prisma;
  const execute = dependencies.executar || executarCicloEnvioGuias;
  const contexto = await conferirContextoCicloFiscal(db);
  if (!contexto || !scheduledAt || typeof assertActive !== 'function') throw Object.assign(new Error('Envio exige uma janela automática reservada.'), { code: 'CICLO_AGENDA_OBRIGATORIA' });
  assertActive();
  const configs = await db.appSetting.findMany({ where: { key: { startsWith: 'envio_guias_config:' } }, select: { key: true, value: true } });
  const results = [];
  for (const config of configs) {
    if (config.value?.enabled !== true) continue;
    assertActive();
    await conferirContextoCicloFiscal(db);
    const portalClientId = config.key.slice('envio_guias_config:'.length);
    const previous = await db.appSetting.findMany({ where: { key: { startsWith: `envio_guias_ciclo:${portalClientId}:` } }, select: { value: true } });
    const periods = [...new Set([competencia, ...previous.map(r => r.value?.competencia).filter(p => /^\d{4}-(0[1-9]|1[0-2])$/.test(p || '') && p < competencia)])];
    for (const period of periods) {
      assertActive();
      try {
        const result = await comAutomacaoEmpresa(portalClientId, () => execute({ portalClientId, competencia: period, scheduledAt, assertActive }, { db }), db, { scheduledAt });
        results.push({ portalClientId, competencia: period, status: result.status, reason: result.reason ?? null });
      } catch (error) {
        results.push({ portalClientId, competencia: period, status: 'REVISAO_NECESSARIA', reason: error.code || 'CICLO_INDISPONIVEL' });
      }
    }
  }
  return { results, empresas: results.length, failed: results.filter(r => ['REVISAO_NECESSARIA', 'REVIEW'].includes(r.status)).length };
}
export function runSimplesEnvioGuiasWorkerLoop() {
  return runRoutineLoop({ worker: 'SIMPLES_ENVIO_GUIAS_WORKER_ENABLED', routines: ['simples_envio_guias'], independent: true, run: runSimplesEnvioGuiasWorkerOnce });
}
