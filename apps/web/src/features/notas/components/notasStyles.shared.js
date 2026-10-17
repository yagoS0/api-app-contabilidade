
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
