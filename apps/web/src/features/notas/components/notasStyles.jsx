// Q12.A.4: paleta + util pra badges de estado.
//
// ⚠ ESTE ARQUIVO É A ALAVANCA DA PALETA: 20 arquivos o importam (notas, apuração, apuracao-v2).
// Repontar os valores para `var(--…)` de `styles/tokens.css` propaga o visual por todos eles sem
// tocar em nenhum consumidor. Não voltar a escrever hex aqui — foi assim que o app acumulou dois
// vermelhos e quatro cinzas de texto concorrentes.

export const PANEL = {
  surface: "var(--bg-subtle)",
  field: "var(--bg-subtle)",
  border: "var(--border)",
  text: "var(--text)",
  muted: "var(--text-muted)",
  accent: "var(--accent-cyan)",
};

export const ESTADO_COLORS = {
  aberto:         { bg: "var(--state-neutral-surface)", text: "var(--text-muted)",     border: "var(--text-muted)",     icon: "⚪", label: "aberto" },
  em_conferencia: { bg: "var(--state-warn-surface)",    text: "var(--state-warn)",     border: "var(--state-warn)",     icon: "🟡", label: "em conferência" },
  fechado:        { bg: "var(--state-neutral-surface)", text: "var(--accent-cyan)",    border: "var(--accent-cyan)",    icon: "🔵", label: "fechado" },
  calculado:      { bg: "var(--state-neutral-surface)", text: "var(--accent-purple)",  border: "var(--accent-purple)",  icon: "🟣", label: "calculado" },
  revisado:       { bg: "var(--state-neutral-surface)", text: "var(--accent-purple)",  border: "var(--accent-purple)",  icon: "🟣", label: "revisado" },
  transmitido:    { bg: "var(--state-ok-surface)",      text: "var(--state-ok)",       border: "var(--state-ok)",       icon: "🟢", label: "transmitido" },
  confirmado:     { bg: "var(--state-ok-surface)",      text: "var(--state-ok)",       border: "var(--state-ok)",       icon: "✅", label: "confirmado" },
  erro:           { bg: "var(--state-danger-surface)",  text: "var(--state-danger)",   border: "var(--state-danger)",   icon: "🔴", label: "erro" },
};

export function StateBadge({ estado }) {
  const c = ESTADO_COLORS[estado] || ESTADO_COLORS.aberto;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 12,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      fontSize: "0.75rem", fontWeight: 500,
    }}>
      <span>{c.icon}</span> {c.label}
    </span>
  );
}

export function fmtMoney(v) {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("pt-BR"); }
  catch { return String(d); }
}

// Q12.B+++.7: detecta staleness do cursor (último sync).
// Importante porque ADN/SEFAZ tem 2 regras:
// - CNPJ inativo 60+ dias perde geração de NSU (NT 2014.002 v1.10)
// - Janela de 90 dias na SEFAZ — notas mais antigas que isso são irrecuperáveis
// Por isso alertamos:
//   30-60 dias = warn (preventivo)
//   60+ dias = danger (já perdendo histórico)
export function syncStaleness(lastSyncAt) {
  if (!lastSyncAt) return { days: null, level: "never" };
  try {
    const ms = Date.now() - new Date(lastSyncAt).getTime();
    const days = Math.floor(ms / (24 * 3600 * 1000));
    let level = "ok";
    if (days >= 60) level = "danger";
    else if (days >= 30) level = "warn";
    return { days, level };
  } catch { return { days: null, level: "never" }; }
}

export function StalenessBadge({ lastSyncAt, label = "Última sync" }) {
  const s = syncStaleness(lastSyncAt);
  let bg = "transparent", color = PANEL.muted, text = "—";
  if (s.level === "ok" && s.days != null) {
    color = PANEL.text;
    text = s.days === 0 ? "hoje" : s.days === 1 ? "ontem" : `${s.days} dias atrás`;
  } else if (s.level === "warn") {
    bg = "rgba(255,179,71,0.15)"; color = "#FFB347";
    text = `⚠ há ${s.days} dias`;
  } else if (s.level === "danger") {
    bg = "rgba(255,71,87,0.15)"; color = "#FF4757";
    text = `🔴 há ${s.days} dias (risco perder NSU)`;
  } else {
    text = "nunca";
  }
  return (
    <span title={label} style={{
      padding: bg !== "transparent" ? "2px 6px" : 0, borderRadius: 4,
      background: bg, color, fontWeight: (s.level === "danger" || s.level === "warn") ? 600 : 400,
    }}>
      {text}
    </span>
  );
}
