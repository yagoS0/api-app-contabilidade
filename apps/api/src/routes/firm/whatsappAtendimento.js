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

export function resumoDoGrupo(grupo, conversa) {
  if (!grupo) return {};
  const { atendimento, segmentos } = grupo;
  const atual = segmentos.find(c => c.portalClientId === atendimento.portalClientId);
  const empresas = [...new Map(segmentos.filter(c => c.portalClient).map(c => [c.portalClientId, {
    id: c.portalClientId, razao: c.portalClient.razao, cnpj: c.portalClient.cnpj, conversaId: c.id, apelidosWhatsapp: c.portalClient.apelidosWhatsapp || [],
  }])).values()];
  const ultimaMudanca = Math.max(...[conversa.updatedAt, atendimento.ultimaInteracaoEm, atendimento.updatedAt].map(d => d ? new Date(d).getTime() || 0 : 0));
  return {
    ...(ultimaMudanca ? { updatedAt: new Date(ultimaMudanca) } : {}),
    atendimento: { id: atendimento.id, versao: atendimento.versao,
      aguardandoSelecao: atendimento.aguardandoSelecao === true,
      empresaAtualId: atual?.portalClientId || null,
      empresaAtual: atual?.portalClient ? { id: atual.portalClientId, razao: atual.portalClient.razao, cnpj: atual.portalClient.cnpj } : null,
      contextoSelecionado: !atendimento.aguardandoSelecao && atendimento.conversaId === conversa.id
        && (!atendimento.expiraEm || new Date(atendimento.expiraEm).getTime() > Date.now()),
      selecaoForaDaCarteira: Boolean(atendimento.portalClientId && !atual),
    },
    empresas,
    atendidaPor: atendimento.atendidaPor || null,
    atendidaDesde: atendimento.atendidaDesde || null,
    naFilaDoEscritorio: Boolean(atendimento.atendidaDesde && !atendimento.atendidaPor),
  };
}

export function filtroMensagensDoGrupo(grupo, empresa = null) {
  const ids = grupo.segmentos.filter(c => !empresa || c.portalClientId === empresa).map(c => c.id);
  return { OR: [
    // Uma entrada resolvida pertence visualmente à empresa da resolução, mesmo que o recibo
    // tenha sido recebido no segmento anterior. Não a mostrar duas vezes nem na empresa errada.
    { conversaId: { in: ids }, contexto: { is: null } },
    { contexto: { is: { atendimentoId: grupo.atendimento.id, conversaId: { in: ids }, portalClientId: { in: grupo.segmentos.filter(c => !empresa || c.portalClientId === empresa).map(c => c.portalClientId) } } } },
    ...(!empresa && grupo.segmentosNeutros?.length ? [{ conversaId: { in: grupo.segmentosNeutros.map(c => c.id) }, OR: [{ contexto: { is: null } }, { contexto: { is: { atendimentoId: grupo.atendimento.id, conversaId: null } } }] }] : []),
  ] };
}

export function empresaDaMensagem(mensagem, grupo) {
  const id = mensagem.contexto?.conversaId || mensagem.conversaId;
  const segmento = grupo?.segmentos.find(c => c.id === id);
  return segmento?.portalClient ? { id: segmento.portalClientId, razao: segmento.portalClient.razao, cnpj: segmento.portalClient.cnpj } : null;
}
