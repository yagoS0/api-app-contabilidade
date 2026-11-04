import { randomUUID } from 'node:crypto';
import { comandoReferencia, dataCivilReferencia, dtoReferencia, erroReferencia, hashComandoReferencia, identidadeReferencia } from './ReferenciaVencimentoPolicy.js';

async function autorizar(tx, companyId, userId, write) {
  // Identidade vem da sessão; papel e vínculo são relidos inclusive antes do replay.
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true, accountType: true } });
  if (!user || String(user.status).toLowerCase() !== 'active') throw erroReferencia('ACCESS_CHANGED', 'Seu acesso precisa ser conferido.', 403);
  if (String(user.role).toLowerCase() !== 'admin') {
    if (user.accountType !== 'FIRM') throw erroReferencia('ACCESS_CHANGED', 'Acesso interno necessário.', 403);
    const access = await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId } } });
    if (access?.status !== 'ACTIVE' || !(write ? ['ACCOUNTANT', 'FIRM_ADMIN'] : ['STAFF', 'ACCOUNTANT', 'FIRM_ADMIN']).includes(access.role)) {
      throw erroReferencia('ACCESS_CHANGED', 'Seu vínculo não permite esta ação na empresa.', 403);
    }
  }
  if (!await tx.portalClient.findUnique({ where: { id: companyId }, select: { id: true } })) throw erroReferencia('COMPANY_NOT_FOUND', 'Empresa não encontrada.', 404);
}
const whereReference = (companyId, identidade) => ({ portalClientId_tributo_tipoPeriodo_competencia_targetKey: { portalClientId: companyId, ...identidade } });
const result = row => ({ reference: dtoReferencia(row), revision: row?.revision ?? 0,
  // Preparação de referência não certifica adaptador nem habilita captura.
  referenceConsumerReady: false, captureCapabilityGranted: false });

export async function lerReferenciaVencimento(db, companyId, userId, input) {
  const identidade = identidadeReferencia(input);
  return db.$transaction(async tx => {
    await autorizar(tx, companyId, userId, false);
    return result(await tx.referenciaVencimentoFiscal.findUnique({ where: whereReference(companyId, identidade) }));
  }, { isolationLevel: 'RepeatableRead' });
}

export async function salvarReferenciaVencimento(db, companyId, userId, input) {
  const command = comandoReferencia(input);
  const requestHash = hashComandoReferencia(companyId, command);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`referencia_vencimento:${companyId}`}))::text`;
    await autorizar(tx, companyId, userId, true);
    const saved = await tx.referenciaVencimentoFiscalEvento.findUnique({ where: { actorId_requestId: { actorId: userId, requestId: command.requestId } } });
    const where = whereReference(companyId, command.identidade);
    const before = await tx.referenciaVencimentoFiscal.findUnique({ where });
    if (saved) {
      if (saved.requestHash !== requestHash) throw erroReferencia('IDEMPOTENCY_CONFLICT', 'A solicitação pertence a outra alteração.');
      if (!before || before.id !== saved.referenceId || before.revision !== saved.revision) throw erroReferencia('REFERENCE_CHANGED', 'A referência mudou após esta solicitação. Recarregue.');
      return result(before);
    }
    if ((before?.revision ?? 0) !== command.expectedRevision) throw erroReferencia('REFERENCE_CHANGED', 'A referência mudou. Recarregue antes de salvar.');
    if (command.acao === 'REVOGAR' && (!before || before.status !== 'ATIVA')) throw erroReferencia('REFERENCE_NOT_ACTIVE', 'Não há referência ativa para revogar.');
    const now = new Date();
    const data = { revision: (before?.revision ?? 0) + 1, updatedBy: userId, updatedAt: now,
      ...(command.acao === 'REVOGAR' ? { status: 'REVOGADA' } : { status: 'ATIVA', dataCivil: dataCivilReferencia(command.dataCivil),
        origem: command.origem, descricaoFonte: command.descricaoFonte, confirmedBy: userId, confirmedAt: now }) };
    if (before) {
      const changed = await tx.referenciaVencimentoFiscal.updateMany({ where: { id: before.id, revision: command.expectedRevision }, data });
      if (changed.count !== 1) throw erroReferencia('REFERENCE_CHANGED', 'A referência mudou durante o salvamento.');
    } else {
      await tx.referenciaVencimentoFiscal.create({ data: { id: randomUUID(), portalClientId: companyId, ...command.identidade, ...data } });
    }
    const after = await tx.referenciaVencimentoFiscal.findUnique({ where });
    await tx.referenciaVencimentoFiscalEvento.create({ data: { id: randomUUID(), referenceId: after.id, actorId: userId,
      requestId: command.requestId, requestHash, revision: after.revision, acao: command.acao, motivo: command.motivo,
      // JSON wrapper evita confundir ausência da versão anterior com SQL NULL.
      before: { reference: dtoReferencia(before) }, after: { reference: dtoReferencia(after) }, createdAt: now } });
    return result(after);
  }, { isolationLevel: 'Serializable' });
}
