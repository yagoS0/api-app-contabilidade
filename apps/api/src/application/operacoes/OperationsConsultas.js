import { contextoOrigemCalculo } from '../notas/apuracao/v2/RecuperacaoCalculo.js';
import { regimeComprovado } from './OperationsEligibility.js';
import { lerAutomacaoCicloFiscal } from '../fiscal/AutomacaoCicloFiscalService.js';
import { lerPoliticaAutomacao } from '../fiscal/serpro/CompanyAutomationPolicy.js';
import { contextosCarteira } from '../company/FluxoCarteiraService.js';
import { lerOperacao, validarCompetencia } from './OperationsService.js';

// Batch the inputs of the existing revision/fingerprint verifier. The adapter only
// supplies its exact selects; adding grouping fields to a hash would invalidate it.
export async function listarEvidenciasOperacoes(db, companyIds, competencia, { rootDb = db } = {}) {
  validarCompetencia(competencia);
  if (!companyIds.length) return { items: [], total: 0, competencia };
  const [ano, mes] = competencia.split('-').map(Number);
  const pas = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(ano, mes - 13 + i, 1)).toISOString().slice(0, 7));
  const portals = await db.portalClient.findMany({ where: { id: { in: companyIds } }, select: { id: true, cnpj: true, companyId: true, razao: true, hasProlabore: true, temFolha: true, empresaZerada: true } });
  const [cadastros, companies, notas, rbts, folha, snapshots, pendencias, settings, histories] = await Promise.all([
    db.cadastroFiscal.findMany({ where: { portalClientId: { in: companyIds } } }),
    db.company.findMany({ where: { id: { in: portals.map(p => p.companyId).filter(Boolean) } }, select: { id: true, cnpj: true, regimeTributario: true, optanteSimples: true, simplesDataOpcao: true, cnaePrincipal: true, cnaesSecundarios: true } }),
    db.portalInvoice.findMany({ where: { clientId: { in: companyIds }, papel: 'EMIT', statusEfetivo: 'autorizada', competencia: { gte: new Date(Date.UTC(ano, mes - 13, 1)), lt: new Date(Date.UTC(ano, mes, 1)) } }, select: { clientId: true, id: true, competencia: true, total: true, itens: { select: { id: true, valor: true, tipoReceita: true, flagST: true, flagMonofasico: true, flagExportacao: true } } } }),
    db.rbtExtratoCache.findMany({ where: { portalClientId: { in: companyIds }, competencia } }),
    db.accountingEntry.findMany({ where: { portalClientId: { in: companyIds }, tipo: 'FOLHA', competencia: { in: pas } }, select: { portalClientId: true, id: true, competencia: true, lines: { select: { tipo: true, valor: true, conta: true } } } }),
    db.apuracaoSnapshot.findMany({ where: { portalClientId: { in: companyIds }, competencia } }),
    db.pendenciaPosFechamento.findMany({ where: { portalClientId: { in: companyIds }, competencia, resolvida: false }, orderBy: { id: 'asc' }, select: { portalClientId: true, id: true, motivo: true, observacoes: true, createdAt: true } }),
    db.appSetting.findMany({ where: { key: { in: ['automacao_ciclo_fiscal', ...companyIds.flatMap(id => [`operations:v1:${id}:${competencia}`, `operations_calculation:${id}:${competencia}`, `ciclo_simples_config:${id}`, `company_automation_policy:${id}`])] } } }),
    db.regimeHistorico.findMany({ where: { companyId: { in: portals.map(p => p.companyId).filter(Boolean) } } }),
  ]);
  const externalCompanies = portals.filter(p => regimeComprovado(histories.filter(h => h.companyId === p.companyId), competencia, cadastros.find(c => c.portalClientId === p.id), companies.find(c => c.id === p.companyId)) === 'PRESUMIDO' && String(companies.find(c => c.id === p.companyId)?.regimeTributario || '').toUpperCase().includes('PRESUMIDO')).map(p => ({ ...p, companyId: p.id, legacyCompany: companies.find(c => c.id === p.companyId) }));
  const externalMap = externalCompanies.length ? await contextosCarteira(externalCompanies, competencia, db) : new Map();
  const executionKeys = settings.filter(s => s.key.startsWith('operations:v1:') && s.value?.releaseId).map(s => `operations_execution:${s.key.slice('operations:v1:'.length, -(competencia.length + 1))}:${competencia}:${s.value.releaseId}`);
  const executions = executionKeys.length ? await db.appSetting.findMany({ where: { key: { in: executionKeys } } }) : [];
  // One scoped read, never a per-company query. A capped result cannot establish
  // absence: expose that uncertainty instead of borrowing mutable operation dates.
  const confirmationLimit = 1000;
  const confirmationRecords = await db.appSetting.findMany({ where: {
    key: { startsWith: 'operations_request:' },
    AND: [{ value: { path: ['competencia'], equals: competencia } }, { value: { path: ['action'], equals: 'confirm' } }],
    OR: companyIds.map(companyId => ({ value: { path: ['companyId'], equals: companyId } })),
  }, select: { key: true, value: true }, orderBy: [{ createdAt: 'desc' }, { key: 'desc' }], take: confirmationLimit + 1 });
  const confirmationTruncated = confirmationRecords.length > confirmationLimit;
  const select = (row, fields) => !row ? null : !fields ? row : Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === true ? row[key] : Array.isArray(row[key]) ? row[key].map(r => select(r, value.select)) : select(row[key], value.select)]));
  const items = [];
  for (const companyId of companyIds) {
    const unique = rows => ({ findUnique: async ({ where, select: fields }) => select(rows.find(r => Object.entries(where).every(([key, value]) => typeof value === 'object' ? Object.entries(value).every(([k, v]) => r[k] === v) : r[key] === value)), fields) });
    const many = rows => ({ findMany: async ({ select: fields }) => rows.map(r => select(r, fields)) });
    const adapter = {
      portalClient: unique(portals), company: unique(companies), cadastroFiscal: unique(cadastros), rbtExtratoCache: unique(rbts),
      apuracaoSnapshot: unique(snapshots), appSetting: unique([...settings, ...executions]),
      portalInvoice: many(notas.filter(n => n.clientId === companyId)), accountingEntry: many(folha.filter(e => e.portalClientId === companyId)),
      pendenciaPosFechamento: many(pendencias.filter(p => p.portalClientId === companyId)),
    };
    const evidence = await lerOperacao(adapter, companyId, competencia, { rootDb });
    const snapshot = snapshots.find(row => row.portalClientId === companyId && row.competencia === competencia);
    // Presentation only, from the same snapshot used by the revision verifier.
    // This compact projection is deliberately not a substitute for the audit,
    // current detail read, or server-side command validation.
    const confirmed = confirmationRecords.slice(0, confirmationLimit).map(record => record.value).find(value =>
      value?.companyId === companyId && value.competencia === competencia && value.action === 'confirm'
      && value.result?.companyId === companyId && value.result?.competencia === competencia
      && value.result?.status === 'CONFIRMED' && value.result?.fingerprint === evidence.fingerprint
      && typeof value.userId === 'string' && value.userId && typeof value.result.changedAt === 'string'
      && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.result.changedAt) && Number.isFinite(Date.parse(value.result.changedAt)));
    const confirmationSummary = { status: confirmationTruncated ? 'INCOMPLETE' : confirmed ? 'AVAILABLE' : 'NOT_FOUND',
      confirmation: !confirmationTruncated && confirmed ? { at: confirmed.result.changedAt, by: confirmed.userId, fingerprint: confirmed.result.fingerprint } : null };
    const portal = portals.find(p => p.id === companyId);
    const regime = regimeComprovado(histories.filter(h => h.companyId === portal?.companyId), competencia, cadastros.find(c => c.portalClientId === companyId), companies.find(c => c.id === portal?.companyId));
    const config = settings.find(s => s.key === `ciclo_simples_config:${companyId}`)?.value;
    let routine;
    try {
      const global = await lerAutomacaoCicloFiscal(adapter), policy = await lerPoliticaAutomacao(adapter, companyId);
      const status = global.paused || policy.paused ? 'PAUSED' : config?.enabled === true ? 'CONFIGURED' : 'DISABLED';
      routine = { status, label: { PAUSED: 'Rotina pausada', CONFIGURED: 'Rotina selecionada', DISABLED: 'Rotina desligada' }[status] };
    } catch { routine = { status: 'UNKNOWN', label: 'Rotina a conferir' }; }
    const savedAttempt = settings.find(s => s.key === `operations_calculation:${companyId}:${competencia}`)?.value;
    const attempt = savedAttempt?.companyId === companyId && savedAttempt.competencia === competencia && typeof savedAttempt.attemptId === 'string'
      && ['COLLECTING', 'CALCULATING', 'CALCULATED', 'REVIEW', 'UNCERTAIN'].includes(savedAttempt.status) ? savedAttempt : null;
    const currentContext = attempt?.status === 'CALCULATED' ? await contextoOrigemCalculo({ portalClientId: companyId, competencia }, adapter) : null;
    const attemptCurrent = attempt?.status === 'CALCULATED' && !evidence.blocked && Boolean(snapshot?.idempotencyKey)
      && snapshot.idempotencyKey === attempt.calculation?.calculoId && currentContext?.hash === attempt.proof?.context?.hash;
    const calculation = attemptCurrent ? { calculoId: attempt.calculation.calculoId, receita: attempt.calculation.receita ?? null, imposto: attempt.calculation.imposto ?? null, origem: attempt.calculation.origem || null } : null;
    const auditSummary = attemptCurrent && attempt.audit ? { status: attempt.audit.status, totalAchados: attempt.audit.totalAchados ?? null, reason: attempt.audit.reason || null, warnings: Array.isArray(attempt.audit.warnings) ? attempt.audit.warnings.filter(w => typeof w === 'string') : [] } : null;
    const calculationWarnings = attemptCurrent && Array.isArray(attempt.warnings) ? attempt.warnings.filter(w => typeof w === 'string') : [];
    const manualCalculation = attempt ? { status: attempt.status === 'CALCULATED' && !attemptCurrent ? 'STALE' : attempt.status, requestId: attempt.attemptId, attemptId: attempt.attemptId, reason: attempt.status === 'CALCULATED' && !attemptCurrent ? 'Cálculo anterior; confira a revisão atual.' : typeof attempt.reason === 'string' ? attempt.reason : null, calculation } : null;
    const tasks = externalMap.get(companyId)?.fluxo.tarefas || [];
    const external = regime === 'PRESUMIDO' ? { regime, apurar: tasks.find(t => t.chave === 'apurar') || null, transmitir: tasks.find(t => t.chave === 'transmitir') || null } : null;
    items.push({ ...evidence, regime, routine, auditSummary, calculationWarnings, manualCalculation, externalSummary: external, confirmationSummary, calculationSummary: snapshot ? {
      receitaInterna: snapshot.receitaInterna ?? null,
      receitaExterna: snapshot.receitaExterna ?? null,
    } : null });
  }
  return { items, total: items.length, competencia };
}

// Codes, never interpreted error text, determine a correction destination.
export function destinoErroConsulta(code) {
  if (['CERTIFICADO_AUSENTE', 'CERTIFICADO_VENCIDO', 'CERTIFICATE_EXPIRED', 'CERTIFICATE_INVALID'].includes(code)) return 'certificado';
  if (['PROCURACAO_AUSENTE', 'PROCURACAO_INVALIDA', 'PROCURACAO_VENCIDA'].includes(code)) return 'automacao';
  return 'automacao';
}
// Local persisted evidence only. Reading this projection never calls fiscal providers.
export async function listarErrosConsultas(prisma, companyIds, competencia) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw Object.assign(new Error('Competência inválida.'), { status: 422 });
  const logs = await prisma.serproChamada.findMany({
    // /Emitir and /Declarar are deliberately outside a consultation indicator.
    // Missing competence is not inferred from the timestamp of the request.
    where: { portalClientId: { in: companyIds }, competencia, rota: '/Consultar' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, assinatura: true, portalClientId: true, competencia: true, idServico: true, status: true, erroCodigo: true, erroMensagem: true, createdAt: true },
  });
  // A refusal is evidence of a blocked attempt, not resolution of a previous
  // result. Keep both axes from the same ordered read (including uncertainty).
  const latest = new Map(), effective = new Map();
  const key = log => JSON.stringify([log.portalClientId, log.assinatura]);
  for (const log of logs) {
    const identity = key(log);
    if (!latest.has(identity)) latest.set(identity, log);
    if (['ok', 'erro'].includes(log.status) && !effective.has(identity)) effective.set(identity, log);
  }
  const pendingAttempt = log => ({ id: log.id, status: log.status, startedAt: log.createdAt,
    situacao: log.status === 'incerta' ? 'incerta' : log.status === 'reservada' ? 'em_processamento' : 'bloqueada' });
  const items = [...effective.values()].filter(log => log.status === 'erro').map(log => {
    const attempt = latest.get(key(log));
    return { id: log.id, companyId: log.portalClientId, competencia: log.competencia,
      action: log.idServico || 'Consulta SERPRO', errorCode: log.erroCodigo || null, correctionTab: destinoErroConsulta(log.erroCodigo), errorMessage: log.erroMensagem, startedAt: log.createdAt,
      tentativaPosterior: attempt.id !== log.id ? pendingAttempt(attempt) : null };
  });
  const tentativasPendentes = [...latest.values()].filter(log => !['ok', 'erro'].includes(log.status))
    .map(log => ({ ...pendingAttempt(log), companyId: log.portalClientId }));
  return { items, total: items.length, competencia, tentativasPendentes, unidade: 'consultas SERPRO com erro no último resultado efetivo da mesma solicitação' };
}
