import { Prisma } from '@prisma/client';
import { bloquearDocumentosDaEmpresa } from '../notas/persistirDocumentoNota.js';
import { hashCanonico, nsuDocumento, erroSync, processarDocumentoSyncLocal } from './ProcessadorDocumentoSyncLocal.js';

const revision = row => `${row.revisao}:${row.stateVersion}`;
const permanent = code => /IDENTIDADE|CONFLIT|SEM_NSU|SEM_IDENTIDADE|SNAPSHOT|LEGADO|NOTA_AUSENTE|EMPRESA|COMPETENCIA_DOCUMENTAL|MES_CONTABIL_FECHADO|PERIODO_FISCAL_FECHADO/.test(code);
export function validarPedidoRecuperacao(body) {
  if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'hash,idempotencyKey,motivo,revisao'
    || typeof body.revisao !== 'string' || body.revisao.length > 100 || !body.revisao
    || typeof body.hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.hash)
    || typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.idempotencyKey)
    || typeof body.motivo !== 'string' || !body.motivo.trim() || body.motivo.length > 1000) throw erroSync('INPUT_INVALIDO', 400);
  return { ...body, motivo: body.motivo.trim() };
}
function legado(state) {
  if (!state?.documentoRecusado) return null;
  const snapshot = state.documentoRecusado;
  const snapshotHash = hashCanonico(snapshot);
  const stateVersion = state.updatedAt.toISOString();
  let nsu = null;
  try { nsu = nsuDocumento(snapshot.item); } catch { /* invalid input remains blocked */ }
  return { id: 'sync_' + hashCanonico({ clientId: state.clientId, snapshotHash, stateVersion }),
    clientId: state.clientId, origem: snapshot.origem || 'DESCONHECIDA', nsu,
    snapshot, snapshotHash, stateVersion, revisao: 1, estado: 'ATIVA',
    motivo: snapshot.motivo || 'SYNC_FAILED', classe: permanent(snapshot.motivo || '') ? 'DOCUMENTAL' : 'TRANSITORIA' };
}
function projetar(row, tentativas = [], isLegacy = false) {
  if (!row) return null;
  return { id: row.id, revisao: revision(row), hash: row.snapshotHash, origem: row.origem, nsu: row.nsu,
    estado: row.estado, motivo: row.motivo, classe: row.classe, legado: isLegacy,
    resultado: row.resultado || null, tentativas: tentativas.map(t => ({ id: t.id, actorId: t.actorId,
      motivo: t.motivo, estado: t.estado, codigo: t.codigo, erroSecundario: t.erroSecundario, conflitos: t.conflitos || [],
      iniciadaEm: t.iniciadaEm, concluidaEm: t.concluidaEm })) };
}
async function empresa(db, clientId) {
  if (!await db.portalClient.findUnique({ where: { id: clientId }, select: { id: true } })) throw erroSync('NOT_FOUND', 404);
}
async function ativo(db, clientId) {
  const state = await db.portalSyncState.findUnique({ where: { clientId } });
  if (!state?.documentoRecusado) return { state, row: null };
  const row = state.syncDocumentoPendenteId
    ? await db.syncDocumentoPendente.findFirst({ where: { id: state.syncDocumentoPendenteId, clientId } })
    : legado(state);
  if (!row) throw erroSync('PENDENCIA_INCONSISTENTE');
  return { state, row };
}
export async function consultarPendenciaSync(db, { clientId, pendenciaId = null }) {
  await empresa(db, clientId);
  if (pendenciaId) {
    const row = await db.syncDocumentoPendente.findFirst({ where: { id: pendenciaId, clientId } });
    if (!row) throw erroSync('NOT_FOUND', 404);
    return projetar(row, await db.syncDocumentoTentativa.findMany({ where: { clientId, pendenciaId }, orderBy: { iniciadaEm: 'asc' } }));
  }
  const { state, row } = await ativo(db, clientId);
  if (!row) return null;
  const persisted = await db.syncDocumentoPendente.findFirst({ where: { id: row.id, clientId } });
  return projetar(persisted || row, persisted ? await db.syncDocumentoTentativa.findMany({ where: { clientId, pendenciaId: row.id }, orderBy: { iniciadaEm: 'asc' } }) : [], !state.syncDocumentoPendenteId && !persisted);
}

// Capture failure is preserved durably without advancing either cursor or backoff.
export async function registrarDocumentoRecusado(db, snapshot) {
  return db.$transaction(async tx => {
    await bloquearDocumentosDaEmpresa(tx, snapshot.clientId);
    const state = await tx.portalSyncState.findUnique({ where: { clientId: snapshot.clientId } });
    if (!state || state.documentoRecusado) throw erroSync('PENDENCIA_CONCORRENTE');
    const row = legado({ ...state, documentoRecusado: snapshot });
    await tx.syncDocumentoPendente.create({ data: row });
    const changed = await tx.portalSyncState.updateMany({ where: { clientId: state.clientId, updatedAt: state.updatedAt,
      documentoRecusado: { equals: Prisma.DbNull } }, data: { documentoRecusado: snapshot,
      syncDocumentoPendenteId: row.id, state: 'ERROR', lastError: row.motivo, lockUntil: null } });
    if (changed.count !== 1) throw erroSync('PENDENCIA_CONCORRENTE');
    return row.id;
  });
}
const replay = attempt => {
  if (attempt.estado === 'SUCESSO') return attempt.resultado;
  throw erroSync(attempt.codigo || 'TENTATIVA_REJEITADA', attempt.httpStatus || 500);
};
export async function recuperarDocumentoSync(db, { clientId, pendenciaId, actorId, pedido }) {
  pedido = validarPedidoRecuperacao(pedido);
  if (!actorId || typeof actorId !== 'string') throw erroSync('UNAUTHORIZED', 401);
  const fingerprint = hashCanonico({ clientId, pendenciaId, actorId, ...pedido });
  // Reservation is a separate committed transaction. A crash can be resumed with this exact key.
  const reservation = await db.$transaction(async tx => {
    await bloquearDocumentosDaEmpresa(tx, clientId);
    await empresa(tx, clientId);
    let row = await tx.syncDocumentoPendente.findFirst({ where: { id: pendenciaId, clientId } });
    if (!row) {
      const current = await ativo(tx, clientId);
      if (!current.row || current.row.id !== pendenciaId) throw erroSync('NOT_FOUND', 404);
      row = await tx.syncDocumentoPendente.create({ data: current.row });
    }
    const prior = await tx.syncDocumentoTentativa.findUnique({ where: { clientId_pendenciaId_idempotencyKey: {
      clientId, pendenciaId, idempotencyKey: pedido.idempotencyKey } } });
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        await tx.syncDocumentoTentativa.update({ where: { id: prior.id }, data: {
          conflitos: [...(Array.isArray(prior.conflitos) ? prior.conflitos : []),
            { codigo: 'IDEMPOTENCY_KEY_DIVERGENTE', actorId, fingerprint, motivo: pedido.motivo, instante: new Date().toISOString() }],
        } });
        return { conflito: true };
      }
      return prior;
    }
    return tx.syncDocumentoTentativa.create({ data: { clientId, pendenciaId, actorId,
      motivo: pedido.motivo, idempotencyKey: pedido.idempotencyKey, revisaoSolicitada: pedido.revisao,
      hashSolicitado: pedido.hash, fingerprint } });
  });
  if (reservation.conflito) throw erroSync('IDEMPOTENCY_KEY_DIVERGENTE');
  if (reservation.estado !== 'EM_ANDAMENTO') return replay(reservation);
  try {
    return await db.$transaction(async tx => {
      await bloquearDocumentosDaEmpresa(tx, clientId);
      const attempt = await tx.syncDocumentoTentativa.findUnique({ where: { id: reservation.id } });
      if (attempt.estado !== 'EM_ANDAMENTO') return replay(attempt);
      const row = await tx.syncDocumentoPendente.findFirst({ where: { id: pendenciaId, clientId } });
      const state = await tx.portalSyncState.findUnique({ where: { clientId } });
      if (!row || row.estado !== 'ATIVA' || revision(row) !== pedido.revisao || row.snapshotHash !== pedido.hash
        || hashCanonico(row.snapshot) !== row.snapshotHash || row.snapshot.clientId !== clientId
        || !state?.documentoRecusado || hashCanonico(state.documentoRecusado) !== row.snapshotHash
        || (state.syncDocumentoPendenteId ? state.syncDocumentoPendenteId !== row.id : state.updatedAt.toISOString() !== row.stateVersion)) throw erroSync('REVISAO_CONFLITANTE');
      const result = await processarDocumentoSyncLocal(tx, row.snapshot);
      const outcome = { ok: true, pendenciaId, tentativaId: attempt.id, clientId, hash: row.snapshotHash,
        revisaoAnterior: revision(row), revisao: `${row.revisao + 1}:${row.stateVersion}`, ...result };
      const updated = await tx.syncDocumentoPendente.updateMany({ where: { id: row.id, clientId,
        estado: 'ATIVA', revisao: row.revisao, snapshotHash: row.snapshotHash },
        data: { estado: 'RESOLVIDA', revisao: { increment: 1 }, resultado: outcome, resolvidoEm: new Date() } });
      if (updated.count !== 1) throw erroSync('REVISAO_CONFLITANTE');
      // Audit success and unblock share the invoice/event transaction; neither can commit alone.
      const audited = await tx.syncDocumentoTentativa.updateMany({ where: { id: attempt.id, estado: 'EM_ANDAMENTO', fingerprint },
        data: { estado: 'SUCESSO', codigo: 'RECUPERADA_LOCALMENTE', httpStatus: 200, resultado: outcome, concluidaEm: new Date() } });
      if (audited.count !== 1) throw erroSync('AUDITORIA_CONFLITANTE');
      const released = await tx.portalSyncState.updateMany({ where: { clientId, updatedAt: state.updatedAt,
        syncDocumentoPendenteId: state.syncDocumentoPendenteId ?? null, documentoRecusado: { equals: state.documentoRecusado } },
        data: { documentoRecusado: Prisma.DbNull, syncDocumentoPendenteId: null } });
      if (released.count !== 1) throw erroSync('LIBERACAO_CONFLITANTE');
      return outcome;
    });
  } catch (primary) {
    if (!primary.status && permanent(primary.code || '')) primary.status = 409;
    let finished;
    try {
      finished = await db.$transaction(async tx => {
        await bloquearDocumentosDaEmpresa(tx, clientId);
        const attempt = await tx.syncDocumentoTentativa.findUnique({ where: { id: reservation.id } });
        // A committed outcome wins over a lost commit response.
        if (attempt.estado !== 'EM_ANDAMENTO') return attempt;
        if (/^(COMPETENCIA_DOCUMENTAL_|MES_CONTABIL_FECHADO_|PERIODO_FISCAL_FECHADO_)/.test(primary.code || '')) {
          await tx.syncDocumentoPendente.updateMany({ where: { id: pendenciaId, clientId,
            estado: 'ATIVA', snapshotHash: pedido.hash }, data: { classe: 'DOCUMENTAL', motivo: primary.code } });
        }
        return tx.syncDocumentoTentativa.update({ where: { id: attempt.id }, data: {
          estado: 'REJEITADA', codigo: primary.code || 'INFRAESTRUTURA', httpStatus: primary.status || 500, concluidaEm: new Date() } });
      });
    } catch (secondary) {
      primary.auditError = secondary.code || secondary.message;
      try {
        await db.syncDocumentoTentativa.updateMany({ where: { id: reservation.id, clientId, estado: 'EM_ANDAMENTO' },
          data: { codigo: primary.code || 'INFRAESTRUTURA', erroSecundario: primary.auditError } });
      } catch (auditUnavailable) { primary.auditPersistenceError = auditUnavailable.code || auditUnavailable.message; }
      throw primary;
    }
    if (finished.estado === 'SUCESSO') return finished.resultado;
    // Report the primary failure, not a synthetic audit error after a successful rejection audit.
    throw primary;
  }
}
