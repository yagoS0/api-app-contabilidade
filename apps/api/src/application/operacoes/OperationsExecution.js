import { conferirCalculoManualOperacoes } from './OperationsCalculationService.js';
import { contextoOrigemCalculo } from '../notas/apuracao/v2/RecuperacaoCalculo.js';
import { lerOperacao } from './OperationsService.js';
import { procuracaoPermitePgdas, documentosPgdas } from '../fiscal/serpro/pgdasDocumentos.js';
import { createHash } from 'node:crypto';
import { comContextoSerpro } from '../fiscal/serpro/serproCallContext.js';
import { completarDocumentosOperacao, motivosBloqueioDocumental } from './OperationsDocuments.js';
import { comVerificacaoTentativaAutomatica } from '../fiscal/automacaoCicloFiscalContext.js';

const fail = message => Object.assign(new Error(message), { status: 409 });
const digits = value => String(value || '').replace(/\D/g, '');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
// JSONB não conserva a ordem de inserção das propriedades. Comparar conteúdo,
// mantendo arrays ordenados e todos os campos, inclusive ids documentais.
const proofHash = value => createHash('sha256').update(JSON.stringify(canonical(value ?? null))).digest('hex');
const documentalFail = () => Object.assign(fail('A declaração ou sua evidência mudou. Confira os documentos antes de continuar.'), { code: 'AUTOMACAO_EMPRESA_VERIFICACAO_INDISPONIVEL' });
export function identidadeDocumental(circular) {
  return { id: circular?.id || null, portalClientId: circular?.portalClientId || null,
    competencia: circular?.competencia || null, numeroDeclaracao: circular?.pgdasNumeroDeclaracao || null,
    declaracaoFileId: circular?.pgdasDeclaracaoFileId || null, reciboFileId: circular?.pgdasReciboFileId || null };
}

// Evidência suplementar da mesma tentativa; nunca substitui a prova fiscal original.
export async function conferirEvolucaoDocumental(db, { companyId, competencia, releaseId, calculoId, calculationProof }) {
  const saved = (await db.appSetting.findUnique({ where: { key: `operations_execution:${companyId}:${competencia}:${releaseId}` } }))?.value;
  const evidence = saved?.evolucaoDocumental;
  if (!evidence) return null;
  const circular = await db.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
  const portal = await db.portalClient.findUnique({ where: { id: companyId } });
  const snapshot = await db.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
  if (saved.status !== 'RUNNING' || saved.companyId !== companyId || saved.competencia !== competencia
    || evidence.releaseId !== releaseId || evidence.calculoId !== calculoId || evidence.proofHash !== proofHash(calculationProof)
    || snapshot?.estado !== 'transmitida' || snapshot.idempotencyKey !== calculoId
    || proofHash(snapshot.simulacaoSerpro?._portalCalculo) !== evidence.proofHash
    || (snapshot.numeroDeclaracao && snapshot.numeroDeclaracao !== evidence.documento.numeroDeclaracao)
    || evidence.cnpj !== digits(portal?.cnpj) || !documentosPgdas(circular, null).extrato
    || proofHash(evidence.documento) !== proofHash(identidadeDocumental(circular))) throw documentalFail();
  return evidence;
}
export async function conferirExecucao(db, { companyId, competencia, userId, isAdmin, contextHash }, procurador) {
  await conferirCalculoManualOperacoes(db, companyId, competencia);
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
    const current = await lerOperacao(tx, companyId, competencia, { rootDb: db });
    if (current.status !== 'RELEASED' || current.revision !== revision || current.blocked) throw fail(current.blocked || 'A liberação mudou. Atualize antes de executar.');
    const context = await contextoOrigemCalculo({ portalClientId: companyId, competencia }, tx);
    const guardArgs = { ...args, contextHash: context.hash };
    await conferirExecucao(tx, guardArgs, procurador);
    await deps.beforeDispatch?.(tx);
    const circular = await tx.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
    const calculation = await tx.apuracaoSnapshot?.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
    const value = { companyId, competencia, userId: String(userId), status: 'RUNNING', startedAt: new Date().toISOString() };
    await tx.appSetting.create({ data: { key, value } });
    return { key, value, releaseId: state.releaseId, calculationProofHash: proofHash(calculation?.simulacaoSerpro?._portalCalculo), calculoId: current.calculation.calculoId, guardArgs, declaracaoComprovada: Boolean(circular?.pgdasNumeroDeclaracao) };
  }, { isolationLevel: 'Serializable', timeout: 20000 });
  const registrarEvolucaoDocumental = ({ before, result }) => db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations:v1:${companyId}:${competencia}`}))::text`;
    const saved = (await tx.appSetting.findUnique({ where: { key: claim.key } }))?.value;
    const state = (await tx.appSetting.findUnique({ where: { key: `operations:v1:${companyId}:${competencia}` } }))?.value;
    const snapshot = await tx.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
    const circular = await tx.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
    const portal = await tx.portalClient.findUnique({ where: { id: companyId } });
    const document = identidadeDocumental(circular), returned = identidadeDocumental(result?.circular);
    if (saved?.status !== 'RUNNING' || state?.status !== 'RELEASED' || state.releaseId !== claim.releaseId || state.contextHash !== claim.guardArgs.contextHash
      || snapshot?.idempotencyKey !== claim.calculoId || snapshot.estado !== 'transmitida'
      || proofHash(snapshot.simulacaoSerpro?._portalCalculo) !== claim.calculationProofHash
      || result?.company?.id !== companyId || !digits(portal?.cnpj) || digits(result.company.cnpj) !== digits(portal.cnpj)
      || document.portalClientId !== companyId || document.competencia !== competencia || !documentosPgdas(circular, null).extrato
      || proofHash(document) !== proofHash(returned) || String(result?.dados?.numeroDeclaracao || '') !== String(document.numeroDeclaracao)
      || result?.files?.declaracaoFileId !== document.declaracaoFileId || result?.files?.reciboFileId !== document.reciboFileId
      || (before.id && before.id !== document.id) || (before.numeroDeclaracao && before.numeroDeclaracao !== document.numeroDeclaracao)
      || (snapshot.numeroDeclaracao && snapshot.numeroDeclaracao !== document.numeroDeclaracao)) throw documentalFail();
    const evidence = { releaseId: claim.releaseId, calculoId: claim.calculoId, proofHash: proofHash(snapshot.simulacaoSerpro?._portalCalculo),
      cnpj: digits(portal.cnpj), before, documento: document, recordedAt: new Date().toISOString() };
    if (saved.evolucaoDocumental) {
      if (proofHash(saved.evolucaoDocumental.documento) !== proofHash(document)) throw documentalFail();
      return;
    }
    await tx.appSetting.update({ where: { key: claim.key }, data: { value: { ...saved, evolucaoDocumental: evidence } } });
  }, { isolationLevel: 'Serializable', timeout: 20000 });
  const finish = patch => db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`operations:v1:${companyId}:${competencia}`}))::text`;
    const saved = (await tx.appSetting.findUnique({ where: { key: claim.key } }))?.value;
    if (saved?.status !== 'RUNNING' || saved.startedAt !== claim.value.startedAt) throw documentalFail();
    await tx.appSetting.update({ where: { key: claim.key }, data: { value: { ...saved, ...patch, finishedAt: new Date().toISOString() } } });
  });
  try {
    const run = () => comContextoSerpro({ origem: 'operacoes:liberacao', userId, forcar: false, registrarEvolucaoDocumental }, async () => {
      await conferirExecucao(db, claim.guardArgs, procurador);
      if (claim.declaracaoComprovada) return { ok: true, jaDeclarado: true, posTransmissao: await completarDocumentosOperacao(db, { portalClientId: companyId, competencia }, deps.documents) };
      return transmit({ portalClientId: companyId, competencia, userId,
        calculoId: claim.calculoId, somenteDocumentosFaltantes: true, antesDeTransmitir: () => conferirExecucao(db, claim.guardArgs, procurador) });
    });
    const result = deps.beforeDispatch
      ? await comVerificacaoTentativaAutomatica({ portalClientId: companyId, competencia, verificar: async ({ db: tx }) => {
        await conferirExecucao(tx, claim.guardArgs, procurador);
        await deps.beforeDispatch(tx);
      } }, run)
      : await run();
    if (result?.ok !== true) throw fail('A execução não confirmou o resultado. Confira a apuração antes de uma nova ação.');
    const missing = Object.values(result.posTransmissao || {}).some(r => r?.skipped || r?.ok === false);
    const blockingReason = Object.values(result.posTransmissao || {}).map(r => motivosBloqueioDocumental[r?.code]).find(Boolean);
    await finish({ status: 'DONE', documentos: result.posTransmissao || null, message: blockingReason || (missing ? 'Apuração processada, mas há documentos faltantes. Confira Tarefas e Guias; não será feita nova consulta automaticamente.' : null) });
    return result;
  } catch (error) {
    await finish({ status: 'ATTENTION', message: motivosBloqueioDocumental[error?.code] || 'Confira o resultado e os documentos antes de nova ação. A tentativa não será repetida automaticamente.' }).catch(() => {});
    throw error;
  }
}
