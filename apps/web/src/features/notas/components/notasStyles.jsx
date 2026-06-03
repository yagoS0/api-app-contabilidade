// Q12.A.4: paleta + util pra badges de estado (consistente com ACCOUNTING_PANEL).

export const PANEL = {
  surface: "#21222C",
  field: "#282A36",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#aeb6d3",
  accent: "#8BE9FD",
};

export const ESTADO_COLORS = {
  aberto:         { bg: "rgba(170, 178, 200, 0.10)", text: "#aeb6d3", border: "#aeb6d3", icon: "⚪", label: "aberto" },
  em_conferencia: { bg: "rgba(255, 179, 71, 0.15)",  text: "#FFB347", border: "#FFB347", icon: "🟡", label: "em conferência" },
  fechado:        { bg: "rgba(139, 233, 253, 0.15)", text: "#8BE9FD", border: "#8BE9FD", icon: "🔵", label: "fechado" },
  calculado:      { bg: "rgba(189, 147, 249, 0.15)", text: "#BD93F9", border: "#BD93F9", icon: "🟣", label: "calculado" },
  revisado:       { bg: "rgba(189, 147, 249, 0.25)", text: "#BD93F9", border: "#BD93F9", icon: "🟣", label: "revisado" },
  transmitido:    { bg: "rgba(105, 255, 71, 0.15)",  text: "#69FF47", border: "#69FF47", icon: "🟢", label: "transmitido" },
  confirmado:     { bg: "rgba(105, 255, 71, 0.25)",  text: "#69FF47", border: "#69FF47", icon: "✅", label: "confirmado" },
  erro:           { bg: "rgba(255, 71, 87, 0.15)",   text: "#FF4757", border: "#FF4757", icon: "🔴", label: "erro" },
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
