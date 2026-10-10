// Valores calculados pelo ledger não são uma conciliação da fatura dos provedores.
export async function obterConsumoAtendimentoComercial({ db, onboardingId, conversaId, desde, ate }) {
  if (!onboardingId) throw new Error("onboarding_necessario_para_consumo");
  const inicio = desde ? new Date(desde) : null;
  const fim = ate ? new Date(ate) : null;
  if ((inicio && !Number.isFinite(inicio.getTime())) || (fim && !Number.isFinite(fim.getTime()))) throw new Error("periodo_consumo_invalido");
  const medirIa = Boolean(conversaId && inicio);
  // A primeira interpretação pode ocorrer antes de criar a ficha. Sua mensagem
  // persistida na coleta é evidência de vínculo, mesmo fora do intervalo temporal.
  const coletas = medirIa ? await db.coletaComercialWhatsapp.findMany({
    where: { atendimentoLead: { onboardingId } }, select: { mensagemId: true },
  }) : [];
  const periodo = { createdAt: { gte: inicio, ...(fim ? { lt: fim } : {}) } };
  const [ia, fiscal] = await Promise.all([
    medirIa ? db.chamadaIa.groupBy({
      by: ["status", "modelo"],
      where: { conversaId, finalidade: "comercial_whatsapp", ...(coletas.length
        ? { OR: [periodo, { mensagemId: { in: coletas.map(c => c.mensagemId) } }] } : periodo) },
      _count: { _all: true },
      _sum: { custoEstimadoCentavos: true, reservaCentavos: true, inputTokens: true, outputTokens: true, cacheReadTokens: true },
    }) : [],
    db.serproChamada.groupBy({ by: ["status", "idServico"], where: { acaoId: onboardingId }, _count: { _all: true } }),
  ]);
  const itensIa = ia.map(g => ({ status: g.status, modelo: g.modelo, chamadas: g._count._all,
    custoUsd: Number(g._sum.custoEstimadoCentavos || 0) / 100,
    reservaUsd: Number(g._sum.reservaCentavos || 0) / 100,
    entrada: g._sum.inputTokens || 0, saida: g._sum.outputTokens || 0, cache: g._sum.cacheReadTokens || 0 }));
  const itensFiscal = fiscal.map(g => ({ status: g.status, servico: g.idServico, chamadas: g._count._all }));
  const somarFiscal = estados => itensFiscal.filter(g => estados.includes(g.status)).reduce((n, g) => n + g.chamadas, 0);
  return {
    gpt: { disponivel: medirIa, moeda: "USD", estimativa: true, desde: inicio?.toISOString() || null,
      custoUsd: medirIa ? itensIa.reduce((n, g) => n + g.custoUsd, 0) : null,
      reservaUsd: medirIa ? itensIa.reduce((n, g) => n + g.reservaUsd, 0) : null, itens: itensIa },
    serpro: { moeda: "BRL", custoConfirmado: null, criterio: "Chamadas registradas; valor a conciliar com a fatura SERPRO.",
      concluidas: somarFiscal(["ok"]), erros: somarFiscal(["erro"]),
      pendentes: somarFiscal(["reservada", "incerta"]), abortadas: somarFiscal(["abortada_auth"]), itens: itensFiscal },
  };
}
