import { createHash } from 'node:crypto';
import { contextoOrigemCalculo, recuperarCalculo } from '../notas/apuracao/v2/RecuperacaoCalculo.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const keyFor = (id, competencia) => `operations:v1:${id}:${competencia}`;
export function validarCompetencia(competencia) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw fail('Competência inválida.', 422);
}

// Estado operacional independente. Nunca escreve em apuração, fechamento, guia ou Calendário.
export async function lerOperacao(db, companyId, competencia) {
  validarCompetencia(competencia);
  const contexto = await contextoOrigemCalculo({ portalClientId: companyId, competencia }, db);
  const [snapshot, pending, saved] = await Promise.all([
    db.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } }),
    db.pendenciaPosFechamento.findMany({ where: { portalClientId: companyId, competencia, resolvida: false }, orderBy: { id: 'asc' }, select: { id: true, motivo: true, observacoes: true, createdAt: true } }),
    db.appSetting.findUnique({ where: { key: keyFor(companyId, competencia) } }),
  ]);
  const fingerprint = hash([contexto.hash, snapshot, pending.map(p => p.id)]);
  const state = saved?.value || { status: 'PENDING', schedule: null };
  const recovery = recuperarCalculo(snapshot, { portalClientId: companyId, competencia, contextoOrigem: contexto, cnpj: contexto.contribuinteCnpj, regimeApuracao: contexto.regimeApuracao });
  const blocked = pending.length ? 'Há notas ou eventos posteriores à apuração. Revise as pendências da competência.'
    : !recovery.calculoRecuperavel ? recovery.calculoRecuperacaoMotivo || 'Abra a apuração para conferir um cálculo válido antes de confirmar.' : null;
  const execution = state.releaseId ? (await db.appSetting.findUnique({ where: { key: `operations_execution:${companyId}:${competencia}:${state.releaseId}` } }))?.value : null;
  const status = execution?.status === 'DONE' ? (pending.length || state.contextHash !== contexto.hash ? 'INVALIDATED' : 'EXECUTED')
    : execution ? 'ATTENTION' : ['CONFIRMED', 'RELEASED'].includes(state.status) && (state.fingerprint !== fingerprint || blocked) ? 'INVALIDATED' : state.status;
  return { companyId, competencia, fingerprint, revision: hash([state, fingerprint]), status, schedule: state.schedule,
    changedAt: state.changedAt || null, blocked, pending, execution: execution ? { status: execution.status, message: execution.message || null } : null,
    calculation: recovery.calculoRecuperavel || recovery.calculoSalvo || null };
}

export async function salvarOperacao(db, companyId, competencia, userId, input, { isAdmin = false } = {}) {
  validarCompetencia(competencia);
  const { action, expectedRevision, requestId, schedule } = input || {};
  if (!['confirm', 'review', 'release', 'schedule'].includes(action) || !/^[a-f0-9]{64}$/.test(expectedRevision || '') || !/^[\w-]{8,100}$/.test(requestId || '')) throw fail('Atualize os dados e confira a ação escolhida.', 422);
  if (action === 'schedule' && schedule !== null && (!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/.test(schedule || '') || !Number.isFinite(Date.parse(`${schedule}:00Z`)) || new Date(`${schedule}:00Z`).toISOString().slice(0, 16) !== schedule)) throw fail('Informe uma data e horário válidos.', 422);
  const requestKey = `operations_request:${userId}:${requestId}`;
  const requestHash = hash([companyId, competencia, action, expectedRevision, schedule ?? null]);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${keyFor(companyId, competencia)}))::text`;
    if (!isAdmin) {
      const access = await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: String(userId) } } });
      if (access?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(access.role)) throw fail('Seu acesso não permite alterar esta empresa.', 403);
    }
    const previousRequest = await tx.appSetting.findUnique({ where: { key: requestKey } });
    if (previousRequest) {
      if (previousRequest.value.hash !== requestHash) throw fail('Solicitação já utilizada para outra alteração.');
      return previousRequest.value.result;
    }
    const before = await lerOperacao(tx, companyId, competencia);
    if (action !== 'schedule' && before.execution && before.execution.status !== 'DONE') throw fail('Há uma tentativa em andamento ou a conferir. Consulte Tarefas e a central de apuração antes de nova ação.');
    if (before.revision !== expectedRevision) throw fail('Os dados mudaram. Atualize e confira novamente antes de continuar.');
    if (['confirm', 'release'].includes(action) && before.blocked) throw fail(before.blocked);
    if (action === 'release' && before.status !== 'CONFIRMED') throw fail('Confirme os dados atuais antes de liberar.');
    const savedState = (await tx.appSetting.findUnique({ where: { key: keyFor(companyId, competencia) } }))?.value;
    const context = await contextoOrigemCalculo({ portalClientId: companyId, competencia }, tx);
    const value = { status: action === 'schedule' ? savedState?.status || before.status : { confirm: 'CONFIRMED', review: 'IN_REVIEW', release: 'RELEASED' }[action],
      releaseId: action === 'release' ? requestId : action === 'schedule' ? savedState?.releaseId || null : null,
      contextHash: action === 'schedule' ? savedState?.contextHash || context.hash : context.hash,
      fingerprint: before.fingerprint, schedule: action === 'schedule' ? schedule : before.schedule,
      changedAt: new Date().toISOString(), changedBy: String(userId) };
    await tx.appSetting.upsert({ where: { key: keyFor(companyId, competencia) }, create: { key: keyFor(companyId, competencia), value }, update: { value } });
    const result = await lerOperacao(tx, companyId, competencia);
    await tx.appSetting.create({ data: { key: requestKey, value: { hash: requestHash, companyId, competencia, action, userId: String(userId), before, result } } });
    return result;
  }, { isolationLevel: 'Serializable', timeout: 20000 });
}
