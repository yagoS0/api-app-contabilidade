import { INCLUDE_CONVERSA, grupoNoEscopo } from '../../application/whatsapp/escopoAtendimentoWhatsapp.js';
export { INCLUDE_CONVERSA, grupoNoEscopo };

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
  if (mensagem.referenciaComercial?.escopo === "PESSOA") return null;
  const id = mensagem.contexto?.conversaId || mensagem.conversaId;
  const segmento = grupo?.segmentos.find(c => c.id === id);
  return segmento?.portalClient ? { id: segmento.portalClientId, razao: segmento.portalClient.razao, cnpj: segmento.portalClient.cnpj } : null;
}
