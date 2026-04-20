import { useState, useEffect } from "react";
const PANEL = {
  page: "#1A1B26",
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
  success: "#69FF47",
  danger: "#FF4757",
  warning: "#FFB347",
};

const ACTION = {
  minHeight: 33,
  padding: "8px 14px",
  borderRadius: 16,
  border: `1px solid ${PANEL.border}`,
  background: PANEL.surface,
  color: PANEL.text,
  font: "inherit",
  fontSize: "0.875rem",
  fontWeight: 600,
  lineHeight: 1,
  cursor: "pointer",
};

// ─── Estilos base ─────────────────────────────────────────────────────────────

const INPUT = {
  height: 36, border: `1px solid ${PANEL.field}`, borderRadius: 8,
  padding: "0 10px", font: "inherit", fontSize: "0.9375rem",
  color: PANEL.text, background: PANEL.field, boxSizing: "border-box", outline: "none",
};

const TDv = { padding: "10px 12px", borderBottom: `1px solid ${PANEL.border}`, verticalAlign: "middle", color: PANEL.text };

// ─── ScopeBadge ───────────────────────────────────────────────────────────────

function ScopeBadge({ scope }) {
  const isGlobal = scope === "GLOBAL";
  return (
    <span style={{
      fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.05em",
      textTransform: "uppercase", padding: "2px 7px", borderRadius: 999,
      background: isGlobal ? "#44475A" : "#BD93F9",
      color: isGlobal ? "#F8F8F2" : "#1A1B26",
      border: "none",
      whiteSpace: "nowrap",
    }}>
      {isGlobal ? "Global" : "Empresa"}
    </span>
  );
}

// ─── HistoricosModal ──────────────────────────────────────────────────────────

export function HistoricosModal({ onClose, onLoadAll, onUpdate, onDelete }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("todos"); // todos | global | empresa
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const result = await onLoadAll();
      setItems(Array.isArray(result) ? result : []);
    } catch {
      setError("Erro ao carregar históricos.");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({ contaDebito: item.contaDebito || "", contaCredito: item.contaCredito || "" });
    setError("");
  }

  async function saveEdit(item) {
    setSaving(true);
    setError("");
    try {
      const result = await onUpdate(item.id, {
        contaDebito: editForm.contaDebito || null,
        contaCredito: editForm.contaCredito || null,
      });
      if (result?.ok) {
        setItems((prev) => prev.map((h) => h.id === item.id ? { ...h, ...result.historico } : h));
        setEditingId(null);
      }
    } catch {
      setError("Erro ao salvar alterações.");
    } finally {
      setSaving(false);
    }
  }

  async function promoteToGlobal(item) {
    setSaving(true);
    setError("");
    try {
      const result = await onUpdate(item.id, { scope: "GLOBAL" });
      if (result?.ok) {
        setItems((prev) => prev.map((h) => h.id === item.id ? { ...h, scope: "GLOBAL" } : h));
      }
    } catch {
      setError("Erro ao promover para global.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setDeletingId(id);
    setError("");
    try {
      await onDelete(id);
      setItems((prev) => prev.filter((h) => h.id !== id));
    } catch {
      setError("Erro ao excluir histórico.");
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = items.filter((h) => {
    if (filter === "global") return h.scope === "GLOBAL";
    if (filter === "empresa") return h.scope === "COMPANY";
    return true;
  });

  const globalCount  = items.filter((h) => h.scope === "GLOBAL").length;
  const empresaCount = items.filter((h) => h.scope === "COMPANY").length;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: PANEL.surface, color: PANEL.text, borderRadius: 16, border: `1px solid ${PANEL.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
        width: "min(860px, 96vw)", maxHeight: "85vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${PANEL.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: PANEL.text }}>Históricos Salvos</h2>
            <p style={{ margin: "2px 0 0", fontSize: "0.875rem", color: PANEL.muted }}>
              Textos reutilizáveis com códigos D/C associados. Salvos automaticamente ao lançar.
            </p>
          </div>
          <button onClick={onClose} style={ACTION}>Fechar</button>
        </div>

        {/* Filtros */}
        <div style={{
          padding: "10px 20px", borderBottom: `1px solid ${PANEL.border}`,
          display: "flex", gap: 8, alignItems: "center", flexShrink: 0,
        }}>
          {[
            { key: "todos",   label: `Todos (${items.length})` },
            { key: "global",  label: `Global (${globalCount})` },
            { key: "empresa", label: `Empresa (${empresaCount})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                padding: "6px 12px", borderRadius: 999, border: "none",
                fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
                background: filter === key ? PANEL.accent : PANEL.field,
                color: filter === key ? PANEL.page : PANEL.muted,
              }}
            >{label}</button>
          ))}
          <div style={{ marginLeft: "auto" }}>
            <button type="button" onClick={load} style={ACTION}>Atualizar</button>
          </div>
        </div>

        {/* Corpo da tabela */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {error && (
            <div style={{ padding: "8px 20px", color: PANEL.danger, fontSize: "0.9375rem" }}>{error}</div>
          )}
          {loading && (
            <div style={{ padding: 32, textAlign: "center", color: PANEL.muted, fontSize: "0.9375rem" }}>
              Carregando...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: PANEL.muted, fontSize: "0.9375rem" }}>
              Nenhum histórico encontrado.{" "}
              {filter !== "todos" && (
                <button onClick={() => setFilter("todos")} style={{ background: "none", border: "none", color: PANEL.accent, cursor: "pointer", fontSize: "0.9375rem" }}>
                  Ver todos
                </button>
              )}
            </div>
          )}
          {!loading && filtered.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ background: PANEL.field }}>
                  {["Histórico", "Débito (D)", "Crédito (C)", "Escopo", "Uso", "Ações"].map((col, i) => (
                    <th key={i} style={{
                      padding: "14px 12px", textAlign: "left", fontWeight: 700,
                      fontSize: "0.875rem", color: PANEL.text,
                      borderBottom: `1px solid ${PANEL.border}`,
                      position: "sticky", top: 0, background: PANEL.field, zIndex: 1,
                    }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => {
                  const isEditing = editingId === h.id;
                  const isDeleting = deletingId === h.id;

                  return (
                    <tr key={h.id} style={{ background: isEditing ? PANEL.surface : PANEL.field }}
                      onMouseEnter={(e) => { if (!isEditing) e.currentTarget.style.background = PANEL.surface; }}
                      onMouseLeave={(e) => { if (!isEditing) e.currentTarget.style.background = PANEL.field; }}
                    >
                      {/* Histórico */}
                      <td style={{ ...TDv, maxWidth: 240 }}>
                        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.text}
                        </div>
                      </td>

                      {/* Débito */}
                      <td style={TDv}>
                        {isEditing ? (
                          <input
                            type="text" inputMode="numeric" value={editForm.contaDebito}
                            onChange={(e) => setEditForm((p) => ({ ...p, contaDebito: e.target.value.replace(/\D/g, "") }))}
                            placeholder="Cód."
                            style={{ ...INPUT, width: 70, textAlign: "center" }}
                          />
                        ) : (
                          <span style={{ fontWeight: 700, color: "#8BE9FD" }}>{h.contaDebito || "—"}</span>
                        )}
                      </td>

                      {/* Crédito */}
                      <td style={TDv}>
                        {isEditing ? (
                          <input
                            type="text" inputMode="numeric" value={editForm.contaCredito}
                            onChange={(e) => setEditForm((p) => ({ ...p, contaCredito: e.target.value.replace(/\D/g, "") }))}
                            placeholder="Cód."
                            style={{ ...INPUT, width: 70, textAlign: "center" }}
                          />
                        ) : (
                          <span style={{ fontWeight: 700, color: "#69FF47" }}>{h.contaCredito || "—"}</span>
                        )}
                      </td>

                      {/* Escopo */}
                      <td style={TDv}>
                        <ScopeBadge scope={h.scope} />
                      </td>

                      {/* Uso */}
                      <td style={{ ...TDv, color: PANEL.muted, textAlign: "center" }}>
                        {h.usageCount}x
                      </td>

                      {/* Ações */}
                      <td style={TDv}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
                          {isEditing ? (
                            <>
                              <button type="button" onClick={() => saveEdit(h)} disabled={saving} style={{ ...ACTION, background: PANEL.success, borderColor: PANEL.success, color: PANEL.page }}>
                                {saving ? "..." : "Salvar"}
                              </button>
                              <button type="button" onClick={() => setEditingId(null)} disabled={saving} style={ACTION}>
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" onClick={() => startEdit(h)} disabled={!!saving || isDeleting} style={ACTION}>
                                Editar
                              </button>
                              {h.scope === "COMPANY" && (
                                <button
                                  type="button"
                                  onClick={() => promoteToGlobal(h)}
                                  disabled={!!saving || isDeleting}
                                  title="Disponibilizar para todas as empresas"
                                  style={ACTION}
                                >
                                  → Global
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDelete(h.id)}
                                disabled={!!saving || isDeleting}
                                style={{ ...ACTION, background: PANEL.danger, borderColor: PANEL.danger }}
                              >
                                {isDeleting ? "..." : "Excluir"}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 20px", borderTop: `1px solid ${PANEL.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexShrink: 0, background: PANEL.field,
        }}>
          <span style={{ fontSize: "0.875rem", color: PANEL.muted }}>
            Históricos <strong>Empresa</strong> aparecem apenas nesta empresa.{" "}
            Históricos <strong>Global</strong> aparecem em todas as empresas do escritório.
          </span>
          <button type="button" onClick={onClose} style={ACTION}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
