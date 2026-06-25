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
