// Intenções de navegação são separadas dos dados pedidos pelos coletores.
// As expressões são ancoradas: "Olá, quero abrir uma empresa" continua sendo um pedido.
const normalizar = texto => String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();

export function pediuMenuExplicitamente(texto) {
  return /^(menu|ajuda|comecar|inicio|voltar(?: ao| para o)? (?:menu|inicio)|(?:ver|mostrar|abrir|quero ver|me mostra)(?: o)? menu)$/.test(normalizar(texto));
}

export function pediuMenuWhatsapp(texto) {
  return pediuMenuExplicitamente(texto)
    || /^(?:(?:oi+|oie+|ola+|bom dia|boa tarde|boa noite)(?: altan)?\s*)+(?:(?:tudo bem|tudo bom|como vai|como estao)(?: com voces)?)?$/.test(normalizar(texto));
}

export function declarouSerCliente(texto) {
  return /^(?:ola |oi )?(?:ja )?sou cliente(?: (?:da )?altan)?$/.test(normalizar(texto));
}

export function pediuEquipeWhatsapp(texto) {
  const t = normalizar(texto);
  return /^(?:(?:quero|preciso|gostaria de) )?(?:falar|conversar) com (?:o |a |um |uma )?(?:contador|contadora|atendente|equipe|pessoa|humano|escritorio|alguem)(?: de verdade| real)?$/.test(t)
    || /^(atendente|contador|contadora|humano|equipe|atendimento humano)$/.test(t)
    || /^(?:chama|chame|chamar) (?:o |a |um |uma )?(?:contador|contadora|atendente|equipe)$/.test(t);
}
