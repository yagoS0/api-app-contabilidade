// Reserva durável por identidade estável do cofre. Nunca armazenar segredo/token.
const falha = () => Object.assign(new Error('Reserva de autenticação CBS indisponível.'), { code: 'CBS_OAUTH_RESERVA_INDISPONIVEL' });
export function criarReservaEmissaoCbs(db) {
  if (typeof db?.$transaction !== 'function') throw falha();
  return async function reservarEmissao({ credencialId, janelaMs, limite, signal } = {}) {
    if (typeof credencialId !== 'string' || !credencialId || credencialId.length > 100 || janelaMs !== 3600000 || limite !== 2 || signal?.aborted) throw falha();
    try {
      return await db.$transaction(async tx => {
        // Colisões do hash só serializam credenciais adicionais, nunca liberam cota.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`CBS_OAUTH:${credencialId}`}, 0))::text`;
        if (signal?.aborted) throw falha();
        const [relogio] = await tx.$queryRaw`SELECT clock_timestamp() AS agora`;
        const agora = relogio?.agora;
        if (!(agora instanceof Date) || !Number.isFinite(agora.getTime())) throw falha();
        const quantidade = await tx.apuracaoCbsTokenEmissao.count({ where: { credencialId, createdAt: { gte: new Date(agora.getTime() - 3600000) } } });
        if (quantidade >= 2) return false;
        if (signal?.aborted) throw falha();
        await tx.apuracaoCbsTokenEmissao.create({ data: { credencialId, createdAt: agora } });
        return true;
      }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
    } catch { throw falha(); }
  };
}
