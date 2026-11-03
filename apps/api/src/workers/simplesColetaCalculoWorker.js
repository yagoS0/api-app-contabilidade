import { prisma } from '../infrastructure/db/prisma.js';
import { executarCicloSimples } from '../application/notas/apuracao/v2/CicloSimplesService.js';
import { comAutomacaoEmpresa, conferirContextoCicloFiscal } from '../application/fiscal/automacaoCicloFiscalContext.js';
import { runRoutineLoop } from './runRoutineLoop.js';

export async function runSimplesColetaCalculoWorkerOnce({ competencia, scheduledAt, assertActive } = {}, dependencies = {}) {
  const db = dependencies.db || prisma;
  const execute = dependencies.executar || executarCicloSimples;
  const contexto = await conferirContextoCicloFiscal(db);
  if (!contexto || !scheduledAt || typeof assertActive !== 'function') throw Object.assign(new Error('Coleta exige uma janela automática reservada.'), { code: 'CICLO_AGENDA_OBRIGATORIA' });
  assertActive();
  const configs = await db.appSetting.findMany({ where: { key: { startsWith: 'ciclo_simples_config:' } }, select: { key: true, value: true } });
  const results = [];
  for (const config of configs) {
    if (config.value?.enabled !== true) continue;
    assertActive();
    await conferirContextoCicloFiscal(db);
    const portalClientId = config.key.slice('ciclo_simples_config:'.length);
    try {
      const result = await comAutomacaoEmpresa(portalClientId, () => execute({ portalClientId, competencia, scheduledAt, assertActive }, { db }), db, { scheduledAt });
      results.push({ portalClientId, status: result.status, reason: result.reason ?? null });
    } catch (error) {
      results.push({ portalClientId, status: 'REVISAO_NECESSARIA', reason: error.code || 'CICLO_INDISPONIVEL' });
    }
  }
  return { results, empresas: results.length, failed: results.filter(r => ['REVISAO_NECESSARIA', 'INCERTO', 'COLETA_PARCIAL'].includes(r.status)).length };
}
export function runSimplesColetaCalculoWorkerLoop() {
  return runRoutineLoop({ worker: 'SIMPLES_COLETA_CALCULO_WORKER_ENABLED', routines: ['simples_coleta_calculo'], independent: true, run: runSimplesColetaCalculoWorkerOnce });
}
