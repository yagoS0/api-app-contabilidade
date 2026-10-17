import { contextoOrigemCalculo } from '../notas/apuracao/v2/RecuperacaoCalculo.js';
import { lerOperacao } from './OperationsService.js';
import { procuracaoPermitePgdas } from '../fiscal/serpro/pgdasDocumentos.js';
import { comContextoSerpro } from '../fiscal/serpro/serproCallContext.js';
import { completarDocumentosOperacao, motivosBloqueioDocumental } from './OperationsDocuments.js';

const fail = message => Object.assign(new Error(message), { status: 409 });
const digits = value => String(value || '').replace(/\D/g, '');
export async function conferirExecucao(db, { companyId, competencia, userId, isAdmin, contextHash }, procurador) {
  if (!isAdmin) {
    const access = await db.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: String(userId) } } });
    if (access?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(access.role)) throw fail('Acesso à empresa alterado. Execução bloqueada.');
  }
  if (await db.pendenciaPosFechamento.count({ where: { portalClientId: companyId, competencia, resolvida: false } })) throw fail('Nota ou evento posterior à apuração. Revise a competência antes de transmitir.');
  const context = await contextoOrigemCalculo({ portalClientId: companyId, competencia }, db);
  if (context.hash !== contextHash) throw fail('Os dados fiscais mudaram após a confirmação. Confira novamente.');
  const stored = (await db.appSetting.findUnique({ where: { key: `serpro_procuration_status:${companyId}` } }))?.value;
  const age = Date.now() - new Date(stored?.checkedAt).getTime();
  if (!procuracaoPermitePgdas(stored) || !(new Date(stored?.validUntil).getTime() > Date.now()) || !(age >= 0 && age < 86400000)
    || digits(stored?.cnpj) !== context.contribuinteCnpj || digits(stored?.procuradorCnpj) !== digits(procurador)) throw fail('Procuração válida para PGDAS-D não comprovada. Atualize a procuração na empresa antes de liberar; nenhuma consulta fiscal foi iniciada.');
}

// Apenas a ação explícita aceita executa. Tentativa registrada jamais é repetida em polling/startup.
export async function executarOperacao(db, args, deps = {}) {
  const { companyId, competencia, userId, revision } = args;
  const runtime = deps.credentials || (await import('../fiscal/serpro/SerproRuntimeSettings.js')).getResolvedSerproCredentials;
  const transmit = deps.transmit || (await import('../notas/apuracao/v2/FechamentoService.js')).transmitirFechamento;
  const procurador = (await runtime()).certificate.document;
  const claim = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations:v1:${companyId}:${competencia}`}))::text`;
    const state = (await tx.appSetting.findUnique({ where: { key: `operations:v1:${companyId}:${competencia}` } }))?.value;
    if (!state?.releaseId) throw fail('Nenhuma liberação disponível.');
    const key = `operations_execution:${companyId}:${competencia}:${state.releaseId}`;
    if (await tx.appSetting.findUnique({ where: { key } })) throw fail('Esta liberação já teve uma tentativa. Confira o resultado em Tarefas; não haverá reenvio automático.');
    const current = await lerOperacao(tx, companyId, competencia);
    if (current.status !== 'RELEASED' || current.revision !== revision || current.blocked) throw fail(current.blocked || 'A liberação mudou. Atualize antes de executar.');
    const context = await contextoOrigemCalculo({ portalClientId: companyId, competencia }, tx);
    const guardArgs = { ...args, contextHash: context.hash };
    await conferirExecucao(tx, guardArgs, procurador);
    const circular = await tx.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
    const value = { companyId, competencia, userId: String(userId), status: 'RUNNING', startedAt: new Date().toISOString() };
    await tx.appSetting.create({ data: { key, value } });
    return { key, value, calculoId: current.calculation.calculoId, guardArgs, declaracaoComprovada: Boolean(circular?.pgdasNumeroDeclaracao) };
  }, { isolationLevel: 'Serializable', timeout: 20000 });
  try {
    const result = await comContextoSerpro({ origem: 'operacoes:liberacao', userId, forcar: false }, async () => {
      await conferirExecucao(db, claim.guardArgs, procurador);
      if (claim.declaracaoComprovada) return { ok: true, jaDeclarado: true, posTransmissao: await completarDocumentosOperacao(db, { portalClientId: companyId, competencia }, deps.documents) };
      return transmit({ portalClientId: companyId, competencia, userId,
        calculoId: claim.calculoId, somenteDocumentosFaltantes: true, antesDeTransmitir: () => conferirExecucao(db, claim.guardArgs, procurador) });
    });
    if (result?.ok !== true) throw fail('A execução não confirmou o resultado. Confira a apuração antes de uma nova ação.');
    const missing = Object.values(result.posTransmissao || {}).some(r => r?.skipped || r?.ok === false);
    const blockingReason = Object.values(result.posTransmissao || {}).map(r => motivosBloqueioDocumental[r?.code]).find(Boolean);
    await db.appSetting.update({ where: { key: claim.key }, data: { value: { ...claim.value, status: 'DONE', finishedAt: new Date().toISOString(), documentos: result.posTransmissao || null, message: blockingReason || (missing ? 'Apuração processada, mas há documentos faltantes. Confira Tarefas e Guias; não será feita nova consulta automaticamente.' : null) } } });
    return result;
  } catch (error) {
    await db.appSetting.update({ where: { key: claim.key }, data: { value: { ...claim.value, status: 'ATTENTION', finishedAt: new Date().toISOString(), message: motivosBloqueioDocumental[error?.code] || 'Confira o resultado e os documentos antes de nova ação. A tentativa não será repetida automaticamente.' } } }).catch(() => {});
    throw error;
  }
}
