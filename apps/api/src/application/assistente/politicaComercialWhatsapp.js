import { INTEGRACAO_IA_COMERCIAL, IA_COMERCIAL_TELEFONES_PILOTO } from "../../config.js";
import { pedidoOperacionalComercial } from "../onboarding/ColetaComercialWhatsappService.js";
import { coletaComercialHabilitada } from "../onboarding/politicaColetaComercial.js";
export function decidirRespostaComercial({
  r,
  flag = INTEGRACAO_IA_COMERCIAL,
  piloto = IA_COMERCIAL_TELEFONES_PILOTO
} = {}) {
  const c = r?.conversa,
    m = r?.mensagem;
  // O início determinístico também cobre saudações e dúvidas. Não cair no
  // modelo comercial quando o coletor deixa uma saudação para o menu.
  if (coletaComercialHabilitada(c?.telefoneE164, { canal: r?.canal, canalId: c?.canalId })) return {
    responde: false,
    motivo: "COLETA_SEM_IA"
  };
  if (!flag || !piloto.includes(String(c?.telefoneE164 || "").replace(/\D/g, ""))) return {
    responde: false,
    motivo: "FORA_DO_PILOTO"
  };
  const caso = r?.casoComercial;
  const comercialConfirmado = Boolean(caso?.onboardingId && !caso.encerradoEm && caso.interlocutorId && r?.interlocutorId === caso.interlocutorId);
  if (pedidoOperacionalComercial(m?.corpo) || (!comercialConfirmado && (c?.portalClientId || c?.atendimentoId || r?.vinculo?.situacao !== "DESCONHECIDO")) || String(c?.chaveEscopo || "").startsWith("legado:")) return {
    responde: false,
    motivo: "SEM_ESCOPO_COMERCIAL"
  };
  if (c.excluidaEm) return {
    responde: false,
    motivo: "CHAT_EXCLUIDO"
  };
  if (c.atendidaPor || c.atendidaDesde) return {
    responde: false,
    motivo: "ASSUMIDA_POR_HUMANO"
  };
  if (c.automacaoInvalidadaEm && new Date(m?.registradaEm).getTime() <= new Date(c.automacaoInvalidadaEm).getTime()) return {
    responde: false,
    motivo: "AUTOMACAO_INVALIDADA"
  };
  if (m?.respondidaPelaIaEm) return {
    responde: false,
    motivo: "JA_RESPONDIDA"
  };
  return {
    responde: true,
    perfil: "LEAD"
  };
}
