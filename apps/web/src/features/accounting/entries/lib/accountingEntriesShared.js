export const TIPO_LABELS = { DESPESA: "Despesa", RECEITA: "Receita", FOLHA: "Folha", PROVISAO: "Provisão", BAIXA: "Baixa", OUTRO: "Outro" };
export const STATUS_LABELS = { RASCUNHO: "Rascunho", CONFIRMADO: "Confirmado", EXPORTADO: "Exportado" };
export const ORIGEM_LABELS = { MANUAL: "Manual", OFX: "OFX", PDF: "PDF" };

export const SUBTIPO_OPTIONS = [
  { key: "DAS", label: "DAS / Simples Nacional" },
  { key: "IRRF", label: "IRRF" },
  { key: "ISS", label: "ISS" },
  { key: "PIS_COFINS", label: "PIS/COFINS" },
  { key: "FGTS", label: "FGTS" },
  { key: "FERIAS", label: "Férias" },
  { key: "DECIMO_TERCEIRO", label: "13º Salário" },
  { key: "OUTROS_TRIBUTOS", label: "Outros Tributos" },
];

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function fmtMoney(val) {
  const n = Number(val);
  return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getCompRange(competencia) {
  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) return { min: "", max: "", defaultDate: "" };
  const [y, m] = competencia.split("-").map(Number);
  const firstDay = new Date(Date.UTC(y, m - 1, 1));
  const lastDay = new Date(Date.UTC(y, m, 0));
  const fmt = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const defaultDate = todayUTC >= firstDay && todayUTC <= lastDay ? fmt(todayUTC) : fmt(firstDay);
  return { min: fmt(firstDay), max: fmt(lastDay), defaultDate };
}

export const INPUT = {
  width: "100%", height: 26, border: "1px solid var(--border)",
  borderRadius: 3, padding: "0 5px", font: "inherit",
  fontSize: "0.8125rem", background: "white", boxSizing: "border-box", outline: "none",
};

export const ACCOUNTING_PANEL = {
  page: "#1A1B26",
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
};

export const TDv = {
  padding: "8px 12px", verticalAlign: "top",
  color: ACCOUNTING_PANEL.text,
  borderRight: "none",
  borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`,
};

export const PANEL_FIELD_STYLE = {
  width: "100%",
  height: 41,
  border: `1px solid ${ACCOUNTING_PANEL.field}`,
  borderRadius: 8,
  padding: "0 12px",
  font: "inherit",
  fontSize: "0.875rem",
  color: ACCOUNTING_PANEL.text,
  background: ACCOUNTING_PANEL.field,
  boxSizing: "border-box",
  outline: "none",
};

export const PANEL_LABEL_STYLE = {
  display: "grid",
  gap: 4,
  minWidth: 0,
  fontSize: "0.875rem",
  fontWeight: 600,
  color: ACCOUNTING_PANEL.muted,
};

export const PANEL_ICON_BUTTON_STYLE = {
  width: 28,
  height: 28,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.9375rem",
  fontWeight: 700,
  color: ACCOUNTING_PANEL.text,
};

export const COLS = [
  { label: "Data", align: "left", width: "110px" },
  { label: "Débito", align: "center", width: "150px" },
  { label: "Crédito", align: "center", width: "150px" },
  { label: "Histórico", align: "left", width: "auto" },
  { label: "Valor (R$)", align: "right", width: "132px" },
  { label: "Tipo", align: "left", width: "110px" },
  { label: "Status", align: "left", width: "120px" },
  { label: "Ações", align: "right", width: "136px" },
];
