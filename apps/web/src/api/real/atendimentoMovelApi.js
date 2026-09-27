import { MODOS_RASCUNHO_ATENDIMENTO } from "@contabilidade/shared";
// O mesmo contrato é usado pela central, pela ficha e pelo aplicativo instalado.
export function atendimentoMovelApi(request) {
  const base = id => `/firm/whatsapp/conversas/${encodeURIComponent(id)}`;
  const validarModo = modo => { if (!MODOS_RASCUNHO_ATENDIMENTO.includes(modo)) throw new Error("Modo de rascunho não reconhecido."); return modo; };
  const json = (method, body) => ({ method, body: JSON.stringify(body) });
  return {
    getRascunhoWhatsapp: (id, modo = "texto") => request(`${base(id)}/rascunho?modo=${encodeURIComponent(validarModo(modo))}`),
    salvarRascunhoWhatsapp: (id, body) => request(`${base(id)}/rascunho`, json("PUT", { ...body, modo: validarModo(body.modo || "texto") })),
    excluirRascunhoWhatsapp: (id, versao, modo = "texto") => request(`${base(id)}/rascunho`, json("DELETE", { modo: validarModo(modo), versao })),
    getIntencaoWhatsapp: (id, key) => request(`${base(id)}/intencoes/${encodeURIComponent(key)}`),
    buscarMensagensWhatsapp: (id, { q, cursor, limite = 20 } = {}) => request(`${base(id)}/buscar?${new URLSearchParams({ q: q || "", limite: String(limite), ...(cursor ? { cursor } : {}) })}`),
    getRetomadaWhatsapp: id => request(`${base(id)}/retomar`),
    retomarConversaWhatsapp: (id, body) => request(`${base(id)}/retomar`, json("POST", body)),
    getArquivoMensagemWhatsapp: (id, mensagemId) => request(`${base(id)}/mensagens/${encodeURIComponent(mensagemId)}/arquivo`),
    getAtendimentoPushConfig: () => request("/firm/whatsapp/push/config"),
    registrarAtendimentoPush: body => request("/firm/whatsapp/push/subscriptions", json("POST", body)),
    revogarAtendimentoPush: body => request("/firm/whatsapp/push/subscriptions", json("DELETE", body)),
  };
}
