// Q28 Fase 3 — máquina de estados da PARCELA (guia de parcelamento).
// PREVISTA → EM_ATRASO → PAGA_A_CONFERIR → CONFIRMADA  (DIVERGENTE como desvio; CANCELADA encerra).

export const PARCELA_ESTADOS = {
  PREVISTA: "PREVISTA",
  EM_ATRASO: "EM_ATRASO",
  PAGA_A_CONFERIR: "PAGA_A_CONFERIR",
  DIVERGENTE: "DIVERGENTE",
  CONFIRMADA: "CONFIRMADA",
  CANCELADA: "CANCELADA",
};

const TRANSICOES = {
  PREVISTA: ["EM_ATRASO", "PAGA_A_CONFERIR", "DIVERGENTE", "CANCELADA"],
  EM_ATRASO: ["PAGA_A_CONFERIR", "DIVERGENTE", "CANCELADA", "PREVISTA"],
  PAGA_A_CONFERIR: ["CONFIRMADA", "DIVERGENTE"],
  DIVERGENTE: ["PAGA_A_CONFERIR", "CONFIRMADA", "CANCELADA"],
  CONFIRMADA: [],
  CANCELADA: [],
};

export function podeTransicionar(de, para) {
  if (!de) return true; // sem estado prévio → aceita o estado inicial
  return (TRANSICOES[de] || []).includes(para);
}

// Estado "em aberto" derivado do vencimento: PREVISTA (a vencer) vs EM_ATRASO (vencida).
export function estadoEmAberto(vencimento, now = new Date()) {
  if (!vencimento) return PARCELA_ESTADOS.PREVISTA;
  const d = new Date(vencimento);
  if (Number.isNaN(d.getTime())) return PARCELA_ESTADOS.PREVISTA;
  return d.getTime() < now.getTime() ? PARCELA_ESTADOS.EM_ATRASO : PARCELA_ESTADOS.PREVISTA;
}

/** Os dois estados que dependem do CALENDÁRIO — e só eles podem ser recalculados. */
export const ESTADOS_EM_ABERTO = Object.freeze([PARCELA_ESTADOS.PREVISTA, PARCELA_ESTADOS.EM_ATRASO]);

/**
 * O estado da parcela DEPOIS de a baixa ser desfeita (estorno), ou `null` quando não há o que mexer.
 *
 * ⚠ ESTORNO NÃO É TRANSIÇÃO — É REBOBINAR, e por isso ele NÃO passa por `podeTransicionar`.
 * A tabela `TRANSICOES` descreve o caminho para FRENTE: `PAGA_A_CONFERIR` só sai para `CONFIRMADA`
 * ou `DIVERGENTE`, e `CONFIRMADA` não sai de lugar nenhum. Isso está certo enquanto o que se
 * pergunta é "para onde a parcela pode avançar". Apagar o lançamento de baixa é outra pergunta: o
 * fato que levou a parcela até ali deixou de existir, então ela volta ao estado que o CALENDÁRIO
 * manda (a vencer × vencida), exatamente como na ingestão.
 *
 * Sem isto, apagar a baixa deixava a parcela `PAGA_A_CONFERIR` sem lançamento nenhum: fora da fila
 * de pendentes (que exige `baixada:false`) e fora da fila de conferência útil — invisível nas duas.
 *
 * ⚠ `CANCELADA` não volta. Parcela cancelada saiu do acordo; ressuscitá-la pela porta dos fundos de
 * um DELETE de lançamento inventaria uma parcela a pagar que ninguém contratou de volta.
 */
export function estadoAposEstorno({ estadoAtual, vencimento, agora = new Date() }) {
  if (!estadoAtual) return null; // guia sem estado de parcela (INSS, DARF) — nada a rebobinar
  if (estadoAtual === PARCELA_ESTADOS.CANCELADA) return null;
  const novo = estadoEmAberto(vencimento, agora);
  return novo === estadoAtual ? null : novo;
}

/**
 * O estado que a parcela DEVERIA ter hoje, ou `null` quando não há nada a mudar.
 *
 * ⚠ ESTE RECÁLCULO NÃO EXISTIA, e a ausência dele é silenciosa da pior forma: `estadoEmAberto` só
 * era chamado UMA VEZ, na ingestão. Uma parcela ingerida antes do vencimento ficava `PREVISTA`
 * para sempre — inclusive meses depois de vencida e não paga. Nenhuma tela mostrava atraso, e o
 * contador de risco de rescisão (que conta prestações não quitadas) nunca teria o que contar.
 *
 * ⚠ SÓ MEXE EM ESTADO EM ABERTO. Parcela paga, confirmada ou cancelada não volta a "em atraso"
 * porque o relógio andou — e `PAGA_A_CONFERIR → EM_ATRASO` nem transição válida é.
 */
export function estadoRecalculado({ estadoAtual, vencimento, agora = new Date() }) {
  if (!ESTADOS_EM_ABERTO.includes(estadoAtual)) return null;
  const novo = estadoEmAberto(vencimento, agora);
  if (novo === estadoAtual) return null;
  // O recálculo respeita a mesma tabela de transições de todo mundo (EM_ATRASO → PREVISTA é
  // legítimo: acontece quando o vencimento é corrigido para frente).
  return podeTransicionar(estadoAtual, novo) ? novo : null;
}
