import { WHATSAPP_COLETA_COMERCIAL, IA_COMERCIAL_TELEFONES_PILOTO, WHATSAPP_IDENTIDADE_V2, WHATSAPP_MULTICANAL } from "../../config.js";

// Canal vem do cadastro resolvido no servidor, nunca do corpo da mensagem.
// A entrada comercial é pública; a identificação e as permissões continuam independentes.
export function coletaComercialHabilitada(telefone, { flag = WHATSAPP_COLETA_COMERCIAL, piloto = IA_COMERCIAL_TELEFONES_PILOTO,
  canal = null, canalId = null, identidade = WHATSAPP_IDENTIDADE_V2, multicanal = WHATSAPP_MULTICANAL } = {}) {
  const entradaComercial = identidade && multicanal && canalId && canal?.id === canalId && canal.ativo === true && canal.finalidade === "COMERCIAL";
  const noPiloto = Array.isArray(piloto) && piloto.includes(String(telefone || "").replace(/\D/g, ""));
  return Boolean(flag && (entradaComercial || noPiloto));
}
