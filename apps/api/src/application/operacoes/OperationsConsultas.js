// Local persisted evidence only. Reading this projection never calls fiscal providers.
export async function listarErrosConsultas(prisma, companyIds, competencia) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw Object.assign(new Error('Competência inválida.'), { status: 422 });
  const logs = await prisma.serproChamada.findMany({
    // /Emitir and /Declarar are deliberately outside a consultation indicator.
    // Missing competence is not inferred from the timestamp of the request.
    where: { portalClientId: { in: companyIds }, competencia, rota: '/Consultar' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, assinatura: true, portalClientId: true, competencia: true, idServico: true, status: true, erroMensagem: true, createdAt: true },
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
      action: log.idServico || 'Consulta SERPRO', errorMessage: log.erroMensagem, startedAt: log.createdAt,
      tentativaPosterior: attempt.id !== log.id ? pendingAttempt(attempt) : null };
  });
  const tentativasPendentes = [...latest.values()].filter(log => !['ok', 'erro'].includes(log.status))
    .map(log => ({ ...pendingAttempt(log), companyId: log.portalClientId }));
  return { items, total: items.length, competencia, tentativasPendentes, unidade: 'consultas SERPRO com erro no último resultado efetivo da mesma solicitação' };
}
