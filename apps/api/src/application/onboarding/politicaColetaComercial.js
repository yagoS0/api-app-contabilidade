import { WHATSAPP_COLETA_COMERCIAL, IA_COMERCIAL_TELEFONES_PILOTO } from "../../config.js";

// O menu e a coleta usam a mesma audiência; não se amplia o piloto do cliente.
export function coletaComercialHabilitada(telefone, { flag = WHATSAPP_COLETA_COMERCIAL, piloto = IA_COMERCIAL_TELEFONES_PILOTO } = {}) {
  return Boolean(flag && Array.isArray(piloto) && piloto.includes(String(telefone || "").replace(/\D/g, "")));
}
