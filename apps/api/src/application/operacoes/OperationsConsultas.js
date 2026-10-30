import { lerOperacao, validarCompetencia } from './OperationsService.js';

// Batch the inputs of the existing revision/fingerprint verifier. The adapter only
// supplies its exact selects; adding grouping fields to a hash would invalidate it.
export async function listarEvidenciasOperacoes(db, companyIds, competencia) {
  validarCompetencia(competencia);
  if (!companyIds.length) return { items: [], total: 0, competencia };
  const [ano, mes] = competencia.split('-').map(Number);
  const pas = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(ano, mes - 13 + i, 1)).toISOString().slice(0, 7));
  const portals = await db.portalClient.findMany({ where: { id: { in: companyIds } }, select: { id: true, cnpj: true, companyId: true } });
  const [cadastros, companies, notas, rbts, folha, snapshots, pendencias, settings] = await Promise.all([
    db.cadastroFiscal.findMany({ where: { portalClientId: { in: companyIds } } }),
    db.company.findMany({ where: { id: { in: portals.map(p => p.companyId).filter(Boolean) } }, select: { id: true, cnpj: true, regimeTributario: true, optanteSimples: true, simplesDataOpcao: true, cnaePrincipal: true, cnaesSecundarios: true } }),
    db.portalInvoice.findMany({ where: { clientId: { in: companyIds }, papel: 'EMIT', statusEfetivo: 'autorizada', competencia: { gte: new Date(Date.UTC(ano, mes - 13, 1)), lt: new Date(Date.UTC(ano, mes, 1)) } }, select: { clientId: true, id: true, competencia: true, total: true, itens: { select: { id: true, valor: true, tipoReceita: true, flagST: true, flagMonofasico: true, flagExportacao: true } } } }),
    db.rbtExtratoCache.findMany({ where: { portalClientId: { in: companyIds }, competencia } }),
    db.accountingEntry.findMany({ where: { portalClientId: { in: companyIds }, tipo: 'FOLHA', competencia: { in: pas } }, select: { portalClientId: true, id: true, competencia: true, lines: { select: { tipo: true, valor: true, conta: true } } } }),
    db.apuracaoSnapshot.findMany({ where: { portalClientId: { in: companyIds }, competencia } }),
    db.pendenciaPosFechamento.findMany({ where: { portalClientId: { in: companyIds }, competencia, resolvida: false }, orderBy: { id: 'asc' }, select: { portalClientId: true, id: true, motivo: true, observacoes: true, createdAt: true } }),
    db.appSetting.findMany({ where: { key: { in: companyIds.map(id => `operations:v1:${id}:${competencia}`) } } }),
  ]);
  const executionKeys = settings.filter(s => s.value?.releaseId).map(s => `operations_execution:${s.key.slice('operations:v1:'.length, -(competencia.length + 1))}:${competencia}:${s.value.releaseId}`);
  const executions = executionKeys.length ? await db.appSetting.findMany({ where: { key: { in: executionKeys } } }) : [];
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
    const evidence = await lerOperacao(adapter, companyId, competencia);
    items.push(evidence);
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
