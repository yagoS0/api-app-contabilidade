import { AsyncLocalStorage } from 'node:async_hooks';
import { conferirAutomacaoCicloFiscal } from './AutomacaoCicloFiscalService.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import { conferirPoliticaAutomacao } from './serpro/CompanyAutomationPolicy.js';

const context = new AsyncLocalStorage();
const verificationContext = new AsyncLocalStorage();
const dispatchStates = new WeakMap();
const verificationError = (code, message) => Object.assign(new Error(message), { code });

export function comVerificacaoTentativaAutomatica({ portalClientId, competencia, verificar } = {}, run) {
  const current = context.getStore();
  if (!current?.company || current.company.portalClientId !== portalClientId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || '') || current.attempt) throw verificationError('AUTOMACAO_EMPRESA_TENTATIVA_INVALIDA', 'A tentativa exige contexto automático empresarial exclusivo.');
  if (typeof verificar !== 'function') throw verificationError('AUTOMACAO_EMPRESA_VERIFICADOR_AUSENTE', 'A tentativa automática não possui verificação de origem.');
  const attempt = Object.freeze({ portalClientId, competencia, verificar });
  dispatchStates.set(attempt, { authorized: false });
  return context.run(Object.freeze({ ...current, attempt }), run);
}

export async function conferirTentativaAutomaticaDespacho(db, { portalClientId, requireAttempt = false } = {}) {
  const current = context.getStore();
  if (!current?.attempt) {
    if (requireAttempt) throw verificationError('AUTOMACAO_EMPRESA_VERIFICADOR_AUSENTE', 'A tentativa automática não possui verificação de origem.');
    return; // Manual e demais rotinas não ganham uma tentativa de cálculo.
  }
  const attempt = current.attempt;
  if (attempt.portalClientId !== current.company?.portalClientId || attempt.portalClientId !== portalClientId || !dispatchStates.has(attempt)) throw verificationError('AUTOMACAO_EMPRESA_TENTATIVA_INVALIDA', 'A tentativa não pertence à empresa do despacho.');
  if (typeof attempt.verificar !== 'function') throw verificationError('AUTOMACAO_EMPRESA_VERIFICADOR_AUSENTE', 'Verificação da tentativa indisponível.');
  if (verificationContext.getStore()) throw verificationError('AUTOMACAO_EMPRESA_VERIFICADOR_RECURSIVO', 'A verificação automática não pode executar outra operação fiscal.');
  try {
    const result = await verificationContext.run(true, () => attempt.verificar({ db: db || current.db, portalClientId, competencia: attempt.competencia }));
    if (result === false) throw verificationError('AUTOMACAO_EMPRESA_BASE_ALTERADA', 'A origem da tentativa não foi confirmada.');
  } catch (error) {
    if (error?.code?.startsWith('AUTOMACAO_EMPRESA_')) throw error;
    throw verificationError('AUTOMACAO_EMPRESA_VERIFICACAO_INDISPONIVEL', 'Não foi possível conferir a origem da tentativa antes do despacho.');
  }
}
export function tentativaAutomaticaSemDespacho() {
  const attempt = context.getStore()?.attempt;
  return Boolean(attempt && dispatchStates.get(attempt)?.authorized === false);
}
// Apenas a conferência local é abrangida. Nunca receber aqui um erro do transporte
// ou de uma simulação que já retornou: esse resultado pode ser fiscalmente incerto.
export async function conferirTentativaAutomaticaAntesSimulacao(db, { portalClientId } = {}) {
  try {
    return await conferirTentativaAutomaticaDespacho(db, { portalClientId, requireAttempt: true });
  } catch (error) {
    const refusal = verificationError(error.code, error.message);
    refusal.recusaAntesDespacho = tentativaAutomaticaSemDespacho();
    throw refusal;
  }
}
export function marcarDespachoTentativaAutomatica() {
  const attempt = context.getStore()?.attempt;
  if (attempt) dispatchStates.get(attempt).authorized = true;
}
// Somente entradas automáticas internas estabelecem o contexto. Corpo HTTP não o controla.
export function comAutomacaoCicloFiscal(policy, run, db) {
  return context.run(Object.freeze({ version: policy.version, scheduledAt: policy.scheduledAt, db: db || prisma }), run);
}
export async function conferirContextoCicloFiscal(db, { requireCompany = false, portalClientId } = {}) {
  if (verificationContext.getStore()) throw verificationError('AUTOMACAO_EMPRESA_VERIFICADOR_RECURSIVO', 'O verificador deve usar somente leituras locais, sem guarda fiscal ou transporte.');
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
