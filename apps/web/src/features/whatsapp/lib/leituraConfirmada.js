// Os resumos globais usam uma API diferente da API filtrada por área do inbox.
export const LEITURA_WHATSAPP_CONFIRMADA = "altan:whatsapp-leitura-confirmada";
export const DEMANDA_SUPORTE_ATUALIZADA = "altan:demanda-suporte-atualizada";

export function notificarLeituraConfirmada() {
  window.dispatchEvent(new Event(LEITURA_WHATSAPP_CONFIRMADA));
}

export function notificarDemandaSuporteAtualizada() {
  window.dispatchEvent(new Event(DEMANDA_SUPORTE_ATUALIZADA));
}
