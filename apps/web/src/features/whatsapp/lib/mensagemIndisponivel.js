// O tipo original continua no histórico. Nunca inventar o conteúdo que a Meta omitiu.
export function mensagemIndisponivel(m) {
  return m?.direcao === "in" && ["unsupported", "unknown"].includes(m.tipo)
    && !m.corpo?.trim() && !m.midiaProvedorId && !m.temMidia && !m.arquivo?.podeAbrir;
}
export const PEDIDO_REENVIO = "Olá! Recebemos uma mensagem sua, mas o WhatsApp não disponibilizou o conteúdo. Pode reenviá-la como texto, foto ou PDF, por favor?";
