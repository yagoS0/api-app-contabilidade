// Formatação pura, compartilhada pelo histórico real e pela avaliação de conversação.
// Usa somente o estado persistido de SaidaWhatsappService; não infere entrega a partir do nome.
const TIPOS = Object.freeze({ document: "documento", image: "imagem" });
const ESTADOS = Object.freeze({
  enviado: { texto: "envio aceito pelo WhatsApp; entrega ao destinatário ainda sem confirmação", campo: "enviadoEm", data: "Data do aceite" },
  entregue: { texto: "entrega confirmada pelo WhatsApp", campo: "entregueEm", data: "Data da entrega" },
  lido: { texto: "leitura confirmada pelo WhatsApp", campo: "lidoEm", data: "Data da leitura" },
});

function dataDoEvento(valor) {
  if (valor == null || valor === "") return null;
  const data = new Date(valor);
  return Number.isFinite(data.getTime()) ? data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;
}

/** Retorna evidência do anexo para o modelo, ou null para mídia de entrada/saída não concluída. */
export function evidenciaDoAnexo(mensagem) {
  const tipo = TIPOS[mensagem?.tipo];
  if (mensagem?.direcao !== "out" || !tipo || ["enviando", "falhou", "indeterminado"].includes(mensagem.statusEnvio)) return null;
  const estado = ESTADOS[mensagem.statusEnvio];
  const identificacao = String(mensagem.corpo || "").trim();
  const evento = estado ? dataDoEvento(mensagem[estado.campo]) : null;
  const registro = dataDoEvento(mensagem.registradaEm);
  return [
    `[Anexo de saída: ${tipo}]`,
    // A coluna contém legenda ou nome; não inventar filename se só a legenda foi gravada.
    `Identificação registrada: ${identificacao ? JSON.stringify(identificacao) : "não informada"}`,
    `Estado: ${estado?.texto || "sem confirmação de envio registrada"}.`,
    evento ? `${estado.data}: ${evento}` : null,
    registro ? `Data do registro: ${registro}` : null,
  ].filter(Boolean).join("\n");
}
