import { INTEGRACAO_IA_COMERCIAL, IA_COMERCIAL_TELEFONES_PILOTO } from "../../config.js";
export function decidirRespostaComercial({
  r,
  flag = INTEGRACAO_IA_COMERCIAL,
  piloto = IA_COMERCIAL_TELEFONES_PILOTO
} = {}) {
  const c = r?.conversa,
    m = r?.mensagem;
  if (!flag || !piloto.includes(String(c?.telefoneE164 || "").replace(/\D/g, ""))) return {
    responde: false,
    motivo: "FORA_DO_PILOTO"
  };
  if (c?.portalClientId || r?.vinculo?.situacao !== "DESCONHECIDO" || String(c?.chaveEscopo || "").startsWith("legado:")) return {
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
