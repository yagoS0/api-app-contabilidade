import { AsyncLocalStorage } from 'node:async_hooks';
import { conferirAutomacaoCicloFiscal } from './AutomacaoCicloFiscalService.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import { conferirPoliticaAutomacao } from './serpro/CompanyAutomationPolicy.js';

const context = new AsyncLocalStorage();
// Somente entradas automáticas internas estabelecem o contexto. Corpo HTTP não o controla.
export function comAutomacaoCicloFiscal(policy, run, db) {
  return context.run(Object.freeze({ version: policy.version, scheduledAt: policy.scheduledAt, db: db || prisma }), run);
}
export async function conferirContextoCicloFiscal(db, { requireCompany = false, portalClientId } = {}) {
  const current = context.getStore();
  if (!current) return null; // Ações manuais conservam suas autorizações próprias.
  const database = db || current.db;
  const policy = await conferirAutomacaoCicloFiscal({ version: current.version, scheduledAt: current.scheduledAt, db: database });
  if ((requireCompany && !current.company) || (portalClientId !== undefined && portalClientId !== current.company?.portalClientId)) {
    throw Object.assign(new Error('Identidade empresarial ausente ou divergente na automação.'), { code: 'AUTOMACAO_EMPRESA_IDENTIDADE_INVALIDA' });
  }
  if (current.company) await conferirPoliticaAutomacao(database, current.company.portalClientId, { version: current.company.version, scheduledAt: current.scheduledAt });
  return policy;
}

export const conferirTransporteCicloFiscal = db => conferirContextoCicloFiscal(db, { requireCompany: true });

export async function comAutomacaoAgendada(policy, run, db) {
  if (context.getStore()) {
    await conferirContextoCicloFiscal(db);
    return run();
  }
  return comAutomacaoCicloFiscal(policy, run, db);
}

// run cria um escopo aninhado; nunca enterWith nem mutação do contexto compartilhado.
export async function comAutomacaoEmpresa(portalClientId, run, db, { scheduledAt } = {}) {
  const current = context.getStore();
  if (!current) return run(); // Manual mantém a política SERPRO e suas demais guardas.
  await conferirContextoCicloFiscal(db);
  if (current.company) {
    await conferirContextoCicloFiscal(db, { requireCompany: true, portalClientId });
    return run();
  }
  const database = db || current.db;
  const itemSchedule = current.scheduledAt || scheduledAt;
  const policy = await conferirPoliticaAutomacao(database, portalClientId, { scheduledAt: itemSchedule });
  if (policy.resumedAt && !itemSchedule) throw Object.assign(new Error('Horário da execução ausente após retomada empresarial.'), { code: 'AUTOMACAO_EMPRESA_HORARIO_ANTERIOR' });
  return context.run(Object.freeze({ ...current, scheduledAt: itemSchedule, db: database, company: Object.freeze({ portalClientId, version: policy.version }) }), run);
}

export async function conferirContribuinteCicloFiscal(cnpj) {
  const current = context.getStore();
  if (!current) return;
  await conferirTransporteCicloFiscal();
  const company = await current.db.portalClient.findUnique({ where: { id: current.company.portalClientId }, select: { cnpj: true } });
  if (!company?.cnpj || String(company.cnpj).replace(/\D/g, '') !== String(cnpj).replace(/\D/g, '')) {
    throw Object.assign(new Error('Contribuinte divergente do contexto empresarial.'), { code: 'AUTOMACAO_EMPRESA_IDENTIDADE_INVALIDA' });
  }
}
