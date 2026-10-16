import { createHash } from 'node:crypto';
import { validarCompetencia } from './OperationsService.js';
import { aplicarRegimeRotinas } from '../fiscal/serpro/CompanyRoutineApplicability.js';
import { tributosSeNaoForPrevidenciario } from '../fiscal/serpro/parseArrecadacao.js';
import { WHERE_GUIA_SEM_PARCELAMENTO } from '../guides/guideContract.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const keyFor = (id, competencia) => `operations_manual_inss:v1:${id}:${competencia}`;
const emptyState = () => ({ applicable: null, responsible: '', dueDate: null, note: '', reason: '' });
function normalizeState(value, status = 422) {
  const keys = ['applicable', 'responsible', 'dueDate', 'note', 'reason'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))
    || !(value.applicable === null || typeof value.applicable === 'boolean')
    || [['responsible', 120], ['note', 2000], ['reason', 500]].some(([k, max]) => typeof value[k] !== 'string' || value[k].length > max)
    || value.dueDate !== null && (typeof value.dueDate !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value.dueDate)
      || !Number.isFinite(Date.parse(`${value.dueDate}T12:00:00Z`)) || new Date(`${value.dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== value.dueDate)) {
    throw fail(status === 503 ? 'O controle de INSS salvo precisa de conferência. Nenhuma alteração foi feita.' : 'Confira os campos e a data do controle manual de INSS.', status);
  }
  const result = { ...value, responsible: value.responsible.trim(), note: value.note.trim(), reason: value.reason.trim() };
  if (result.applicable !== null && !result.reason) throw fail('Informe o motivo da exceção nesta competência.', status);
  return result;
}

// Only local evidence. No fiscal, storage download, transmission, payment or calendar writes.
export async function listarInssManual(db, companyIds, competencia) {
  validarCompetencia(competencia);
  const ids = [...new Set(companyIds)].filter(id => typeof id === 'string' && id);
  if (!ids.length) return { items: [] };
  const companies = await db.portalClient.findMany({ where: { id: { in: ids } }, select: { id: true, companyId: true, razao: true, hasProlabore: true } });
  const foundIds = companies.map(c => c.id);
  const where = { portalClientId: { in: foundIds }, competencia, tipo: 'INSS', ...WHERE_GUIA_SEM_PARCELAMENTO };
  const [legacy, settings, guides, pdfs] = await Promise.all([
    db.company.findMany({ where: { id: { in: companies.map(c => c.companyId).filter(Boolean) } }, select: { id: true, regimeTributario: true, tipoTributario: true } }),
    db.appSetting.findMany({ where: { key: { in: foundIds.map(id => keyFor(id, competencia)) } } }),
    db.guide.findMany({ where, orderBy: { id: 'asc' }, select: { id: true, portalClientId: true, status: true, valor: true, vencimento: true, hash: true, updatedAt: true, extracted: true, storageKey: true } }),
    // Ask the database for identities, never load PDF bytes into the dashboard.
    db.guide.findMany({ where: { ...where, AND: [{ pdfBytes: { not: null } }, { NOT: { pdfBytes: Buffer.alloc(0) } }] }, select: { id: true } }),
  ]);
  const legacyMap = new Map(legacy.map(c => [c.id, c])), settingsMap = new Map(settings.map(s => [s.key, s.value]));
  const pdfIds = new Set(pdfs.map(g => g.id));
  const guideMap = new Map();
  for (const guide of guides) { const list = guideMap.get(guide.portalClientId) || []; list.push(guide); guideMap.set(guide.portalClientId, list); }
  return { items: companies.map(company => {
    const saved = settingsMap.get(keyFor(company.id, competencia));
    if (settingsMap.has(keyFor(company.id, competencia)) && (!saved || typeof saved !== 'object' || !saved.state || typeof saved.changedAt !== 'string' || typeof saved.changedBy !== 'string')) throw fail('O controle de INSS salvo precisa de conferência. Nenhuma alteração foi feita.', 503);
    const state = saved ? normalizeState(saved.state, 503) : emptyState();
    const regime = aplicarRegimeRotinas(legacyMap.get(company.companyId)).regime;
    const applicable = state.applicable ?? company.hasProlabore === true;
    const rows = guideMap.get(company.id) || [];
    const documents = rows.map(g => {
      const wrongTax = tributosSeNaoForPrevidenciario(g.extracted?.composicao || []);
      const available = g.status === 'PROCESSED' && pdfIds.has(g.id) && !wrongTax;
      const reviewReason = available ? null : g.status === 'VAZIO' ? 'Registro sem guia; não comprova documento disponível.'
        : wrongTax ? 'A composição indica tributos não previdenciários. Confira a classificação.'
          : g.status !== 'PROCESSED' ? 'A guia ainda precisa de processamento ou revisão.'
            : g.storageKey ? 'Documento em armazenamento externo; confira a disponibilidade em Guias.' : 'PDF local ausente. Confira ou anexe a guia.';
      return { id: g.id, status: g.status, available, reviewReason, valor: g.valor == null ? null : String(g.valor), vencimento: g.vencimento ? new Date(g.vencimento).toISOString() : null };
    });
    const review = documents.some(g => !g.available && g.status !== 'VAZIO');
    return { companyId: company.id, companyName: company.razao, competencia, hasProlabore: company.hasProlabore === true, regime,
      applicable, applicabilitySource: state.applicable === null ? 'company' : 'month', state,
      revision: hash([company.id, competencia, company.hasProlabore, regime, saved ?? null, rows.map(g => [g.id, g.status, g.hash, g.updatedAt, g.extracted, g.storageKey, pdfIds.has(g.id)])]),
      applicabilityConflict: !applicable && documents.some(g => g.status !== 'VAZIO'),
      guides: documents, status: !applicable ? documents.some(g => g.status !== 'VAZIO') ? 'DOCUMENT_REVIEW' : 'NOT_APPLICABLE' : review ? 'DOCUMENT_REVIEW' : documents.some(g => g.available) ? 'DOCUMENT_AVAILABLE' : 'PENDING_DOCUMENT',
      changedAt: saved?.changedAt || null, changedBy: saved?.changedBy || null };
  }) };
}

export async function lerInssManual(db, companyId, competencia) {
  const result = (await listarInssManual(db, [companyId], competencia)).items[0];
  if (!result) throw fail('Empresa não encontrada.', 404);
  return result;
}

export async function salvarInssManual(db, companyId, competencia, userId, input, { isAdmin = false } = {}) {
  validarCompetencia(competencia);
  const { expectedRevision, requestId } = input || {};
  if (!/^[a-f0-9]{64}$/.test(expectedRevision || '') || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId || '')) throw fail('Atualize o controle antes de salvar.', 422);
  const state = normalizeState(input.state);
  const requestKey = `operations_manual_inss_request:${userId}:${requestId}`;
  const requestHash = hash([companyId, competencia, expectedRevision, state]);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${keyFor(companyId, competencia)}))::text`;
    if (!isAdmin) {
      const access = await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: String(userId) } } });
      if (access?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(access.role)) throw fail('Seu acesso não permite alterar esta empresa.', 403);
    }
    const previous = await tx.appSetting.findUnique({ where: { key: requestKey } });
    if (previous) {
      if (previous.value?.hash !== requestHash) throw fail('Solicitação já utilizada para outra alteração.');
      return previous.value.result;
    }
    const before = await lerInssManual(tx, companyId, competencia);
    if (before.revision !== expectedRevision) throw fail('Os dados mudaram. Atualize e confira antes de salvar.');
    if (state.applicable !== before.state.applicable && !state.reason) throw fail('Informe o motivo da mudança de aplicabilidade nesta competência.', 422);
    const value = { state, changedAt: new Date().toISOString(), changedBy: String(userId) };
    const key = keyFor(companyId, competencia);
    await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    const result = await lerInssManual(tx, companyId, competencia);
    await tx.appSetting.create({ data: { key: requestKey, value: { hash: requestHash, companyId, competencia, userId: String(userId), before, result } } });
    return result;
  }, { isolationLevel: 'Serializable', timeout: 20000 });
}
