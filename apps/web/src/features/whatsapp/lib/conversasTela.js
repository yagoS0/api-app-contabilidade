// A TELA DE CONVERSAS DE WHATSAPP — a regra, pura. A página só liga.
//
// Três perguntas que a tela responde ANTES do clique:
//   1. o que esta linha É (fila do escritório? assumida? com a IA? com pendência aberta?) — `situacaoDoFio`;
//   2. dá para responder à mão AGORA? — `estadoDaResposta` (a janela de 24h, dita antes de digitar);
//   3. quem escreveu cada balão — `rotuloDoAutor`.
//
// ⚠ NADA aqui decide envio: quem recusa fora da janela é o SERVIDOR (409 `FORA_DA_JANELA`). A tela
// só evita oferecer um campo que vai ser recusado — e, quando oferece a explicação, ela é a mesma
// que o servidor daria.

export const FILTROS = Object.freeze([
  { valor: "todas", rotulo: "Todas" },
  { valor: "nao-vinculadas", rotulo: "Não vinculadas (fila)" },
  { valor: "atendidas-por-mim", rotulo: "Assumidas por mim" },
]);

export const SITUACAO_FIO = Object.freeze({
  FILA_SEM_EMPRESA: "FILA_SEM_EMPRESA",
  FILA_DO_ESCRITORIO: "FILA_DO_ESCRITORIO",
  ASSUMIDA: "ASSUMIDA",
  COM_A_IA: "COM_A_IA",
});

export function situacaoDoFio(c) {
  if (!c?.portalClientId) return SITUACAO_FIO.FILA_SEM_EMPRESA;
  if (c.atendidaPor) return SITUACAO_FIO.ASSUMIDA;
  if (c.atendidaDesde || c.naFilaDoEscritorio) return SITUACAO_FIO.FILA_DO_ESCRITORIO;
  return SITUACAO_FIO.COM_A_IA;
}

/** O rótulo curto da linha — e o tom (âmbar = pendência do escritório; neutro = o resto). */
export function rotuloDaSituacao(c) {
  const s = situacaoDoFio(c);
  if (s === SITUACAO_FIO.FILA_SEM_EMPRESA) {
    const motivo = c?.vinculo?.motivo;
    return { situacao: s, texto: motivo === "AMBIGUO" ? "número em mais de uma empresa — escolha" : "número sem cadastro — vincule", tom: "aviso" };
  }
  if (s === SITUACAO_FIO.ASSUMIDA) return { situacao: s, texto: `assumida por ${c.atendente?.nome || c.atendente?.email || "alguém do escritório"}`, tom: "neutro" };
  if (s === SITUACAO_FIO.FILA_DO_ESCRITORIO) return { situacao: s, texto: "o assistente chamou o escritório", tom: "aviso" };
  return { situacao: s, texto: "com o assistente", tom: "neutro" };
}

export const AUTOR = Object.freeze({ IA: "IA", HUMANO: "HUMANO", SISTEMA: "SISTEMA" });

/** Quem escreveu o balão. Entrada = o cliente; saída sem autor = o envio de guia (template). */
export function rotuloDoAutor(m, { nomeDoCliente = null } = {}) {
  if (m?.direcao === "in") return nomeDoCliente || "cliente";
  if (m?.autor === AUTOR.IA) return "assistente (IA)";
  if (m?.autor === AUTOR.HUMANO) return "escritório";
  if (m?.autor === AUTOR.SISTEMA) return "mensagem fixa";
  if (m?.tipo === "template") return "escritório (modelo)";
  return "escritório";
}

/**
 * Responder à mão: pode? A janela de 24h dita ANTES de digitar.
 * @returns {{pode:boolean, motivo:string|null, situacao:string|null}}
 */
export function estadoDaResposta(conversa) {
  const j = conversa?.janela;
  if (!j) return { pode: false, motivo: "Ainda não sei se a janela de 24h está aberta.", situacao: null };
  if (j.situacao === "ABERTA") return { pode: true, motivo: null, situacao: j.situacao };
  if (j.situacao === "NUNCA_ABERTA") return { pode: false, motivo: "Este cliente nunca escreveu por aqui: a Meta só aceita texto livre nas 24h seguintes a uma mensagem dele. Iniciar exige um modelo aprovado.", situacao: j.situacao };
  if (j.situacao === "EXPIRADA") return { pode: false, motivo: "A janela de 24h desde a última mensagem do cliente fechou: só modelo aprovado agora (o modelo reabrir_conversa ainda não foi aprovado na Meta).", situacao: j.situacao };
  return { pode: false, motivo: "A janela de 24h não pôde ser calculada — confira antes de responder.", situacao: j.situacao };
}

export function fmtDataHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** O consumo do assistente, como frase — ESTIMATIVA, e a frase diz. */
export function fraseDoConsumo(consumo) {
  if (!consumo?.escritorio) return "Consumo do assistente: não foi possível ler.";
  const e = consumo.escritorio;
  const usd = (c) => `US$ ${(Number(c || 0) / 100).toFixed(2)}`;
  const estado = e.estourado ? " · TETO ATINGIDO — o assistente está recusando" : e.alerta ? " · perto do teto" : "";
  return `Assistente (IA) neste mês: ${usd(e.centavos)} de ${usd(e.teto)} (estimativa, ${e.chamadas} chamada${e.chamadas === 1 ? "" : "s"})${estado}.`;
}

/** Ordena: fila do escritório/sem empresa primeiro (é pendência), depois por atualização. */
export function ordenarConversas(lista) {
  const peso = (c) => (situacaoDoFio(c) === SITUACAO_FIO.FILA_SEM_EMPRESA || situacaoDoFio(c) === SITUACAO_FIO.FILA_DO_ESCRITORIO ? 0 : 1);
  return [...(lista || [])].sort((a, b) => peso(a) - peso(b) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}
