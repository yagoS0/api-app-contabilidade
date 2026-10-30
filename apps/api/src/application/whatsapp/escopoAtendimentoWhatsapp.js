// O agrupamento é uma apresentação: cada segmento e cada mensagem conserva a própria empresa.
export const INCLUDE_CONVERSA = {
  portalClient: { select: { id: true, razao: true, cnpj: true, apelidosWhatsapp: true } },
  atendente: { select: { id: true, name: true, email: true } },
  atendimento: true,
};

export async function grupoNoEscopo({ conversa, visiveis, client }) {
  if (!conversa.atendimentoId || String(conversa.chaveEscopo || "").startsWith("legado:")) return null;
  const atendimento = conversa.atendimento || await client.atendimentoResponsavelWhatsapp.findUnique({ where: { id: conversa.atendimentoId } });
  if (!atendimento) return null;
  const segmentos = await client.conversaWhatsapp.findMany({
    where: { atendimentoId: atendimento.id, portalClientId: { in: visiveis },
      excluidaEm: conversa.excluidaEm ? { not: null } : null, NOT: { chaveEscopo: { startsWith: "legado:" } } },
    include: INCLUDE_CONVERSA,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  // Defesa também no retorno: nenhum nome nem ID fora da carteira compõe o agrupamento.
  const foraDaCarteira = await client.conversaWhatsapp.findFirst({
    where: { atendimentoId: atendimento.id, portalClientId: { not: null, notIn: visiveis } }, select: { id: true },
  });
  const segmentosNeutros = foraDaCarteira ? [] : await client.conversaWhatsapp.findMany({
    where: { atendimentoId: atendimento.id, portalClientId: null, excluidaEm: conversa.excluidaEm ? { not: null } : null,
      OR: [{ chaveEscopo: { startsWith: "sem-empresa:" } }, { chaveEscopo: { startsWith: "legado:sem-empresa:" } }] },
    select: { id: true, lidaAteEm: true },
  });
  return { atendimento, segmentos: segmentos.filter(c => c.atendimentoId === atendimento.id && visiveis.includes(c.portalClientId)), segmentosNeutros };
}

