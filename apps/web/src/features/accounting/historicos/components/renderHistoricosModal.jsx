import "./historicos-modal.css";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
import { useCallback, useState, useEffect, useRef } from "react";
const PANEL = {
  page: "var(--bg-page)",
  surface: "var(--bg-surface)",
  field: "var(--bg-subtle)",
  border: "var(--border)",
  text: "var(--text)",
  muted: "var(--text-muted)",
  accent: "var(--accent-purple)",
  success: "var(--success)",
  danger: "var(--danger)",
  warning: "#FFB347",
};


// ─── Estilos base ─────────────────────────────────────────────────────────────

const INPUT = {
  minHeight: 40, border: `1px solid ${PANEL.field}`, borderRadius: 8,
  padding: "0 10px", font: "inherit", fontSize: "0.9375rem",
  color: PANEL.text, background: PANEL.field, boxSizing: "border-box",
};

const TDv = { padding: "10px 12px", borderBottom: `1px solid ${PANEL.border}`, verticalAlign: "middle", color: PANEL.text };

// ─── ScopeBadge ───────────────────────────────────────────────────────────────

function ScopeBadge({ scope }) {
  const isGlobal = scope === "GLOBAL";
  return (
    <span style={{
      fontSize: "0.8125rem", fontWeight: 500,
      padding: "2px 7px", borderRadius: 999,
      background: "var(--bg-subtle)",
      color: "var(--text-muted)",
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
  const [promotingId, setPromotingId] = useState(null);
  const [error, setError] = useState("");
  const onLoadAllRef = useRef(onLoadAll);
  onLoadAllRef.current = onLoadAll;
  const trava = useRef(false);
  const ocupado = saving || deletingId !== null;
  const fechar = () => { if (!trava.current) onClose(); };



  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const result = await onLoadAllRef.current();
      setItems(Array.isArray(result) ? result : []);
    } catch {
      setError("Erro ao carregar históricos.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({ contaDebito: item.contaDebito || "", contaCredito: item.contaCredito || "" });
    setError("");
  }

  async function saveEdit(item) {
    if (trava.current) return;
    trava.current = true;
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
      } else { setError(result?.message || "Erro ao salvar alterações."); }
    } catch {
      setError("Erro ao salvar alterações.");
    } finally {
      trava.current = false;
      setSaving(false);
    }
  }

  async function promoteToGlobal(item) {
    if (trava.current) return;
    trava.current = true;
    setSaving(true);
    setPromotingId(item.id);
    setError("");
    try {
      const result = await onUpdate(item.id, { scope: "GLOBAL" });
      if (result?.ok) {
        setItems((prev) => prev.map((h) => h.id === item.id ? { ...h, scope: "GLOBAL" } : h));
      } else { setError(result?.message || "Erro ao promover para global."); }
    } catch {
      setError("Erro ao promover para global.");
    } finally {
      trava.current = false;
      setSaving(false);
      setPromotingId(null);
    }
  }

  async function handleDelete(id) {
    if (trava.current) return;
    trava.current = true;
    setDeletingId(id);
    setError("");
    try {
      await onDelete(id);
      setItems((prev) => prev.filter((h) => h.id !== id));
    } catch {
      setError("Erro ao excluir histórico.");
    } finally {
      trava.current = false;
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
    <Modal className="historicos-modal" titulo="Históricos salvos" tamanho="lg" ocupado={ocupado} aoFechar={fechar} fecharAoClicarFundo={false} rodape={<Button variant="secondary" onClick={fechar} disabled={ocupado}>Fechar</Button>}>
      <fieldset disabled={ocupado} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {/* Filtros */}
        <div style={{
          padding: "10px 20px", borderBottom: `1px solid ${PANEL.border}`,
          display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", flexShrink: 0,
        }}>
          {[
            { key: "todos",   label: `Todos (${items.length})` },
            { key: "global",  label: `Global (${globalCount})` },
            { key: "empresa", label: `Empresa (${empresaCount})` },
          ].map(({ key, label }) => (
            <Button variant="secondary" type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              style={{
                padding: "6px 12px", borderRadius: 999, border: "none",
                fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
                background: filter === key ? PANEL.accent : PANEL.field,
                color: filter === key ? PANEL.page : PANEL.muted,
              }}
            >{label}</Button>
          ))}
          <div style={{ marginLeft: "auto" }}>
            <Button variant="secondary" type="button" onClick={load} disabled={loading || ocupado}>Atualizar</Button>
          </div>
        </div>

        {/* Corpo da tabela */}
        <div className="historicos-modal-corpo" style={{ minWidth: 0 }}>
          {error && (
            <div role="alert" style={{ padding: "8px 20px", color: PANEL.danger, fontSize: "0.9375rem" }}>{error}</div>
          )}
          {loading && (
            <div role="status" style={{ padding: 32, textAlign: "center", color: PANEL.muted, fontSize: "0.9375rem" }}>
              Carregando...
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: PANEL.muted, fontSize: "0.9375rem" }}>
              Nenhum histórico encontrado.{" "}
              {filter !== "todos" && (
                <Button variant="secondary" type="button" onClick={() => setFilter("todos")}>
                  Ver todos
                </Button>
              )}
            </div>
          )}
          {!loading && filtered.length > 0 && (
            <div role="region" aria-label="Históricos salvos" tabIndex={0} style={{ overflowX: "auto" }}><table className="historicos-modal-tabela" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ background: PANEL.field }}>
                  {["Histórico", "Débito (D)", "Crédito (C)", "Escopo", "Uso", "Ações"].map((col, i) => (
                    <th key={i} style={{
                      padding: "14px 12px", textAlign: "left", fontWeight: 600,
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
                      <td data-label="Histórico" style={{ ...TDv, maxWidth: 280 }}>
                        <div style={{ fontWeight: 500, overflowWrap: "anywhere" }}>
                          {h.text}
                        </div>
                      </td>

                      {/* Débito */}
                      <td data-label="Débito (D)" style={TDv}>
                        {isEditing ? (
                          <input
                            aria-label="Conta de débito" type="text" inputMode="numeric" value={editForm.contaDebito}
                            onChange={(e) => setEditForm((p) => ({ ...p, contaDebito: e.target.value.replace(/\D/g, "") }))}
                            placeholder="Cód."
                            style={{ ...INPUT, width: 70, textAlign: "center" }}
                          />
                        ) : (
                          <span style={{ fontWeight: 500, color: PANEL.text }}>{h.contaDebito || "—"}</span>
                        )}
                      </td>

                      {/* Crédito */}
                      <td data-label="Crédito (C)" style={TDv}>
                        {isEditing ? (
                          <input
                            aria-label="Conta de crédito" type="text" inputMode="numeric" value={editForm.contaCredito}
                            onChange={(e) => setEditForm((p) => ({ ...p, contaCredito: e.target.value.replace(/\D/g, "") }))}
                            placeholder="Cód."
                            style={{ ...INPUT, width: 70, textAlign: "center" }}
                          />
                        ) : (
                          <span style={{ fontWeight: 500, color: PANEL.text }}>{h.contaCredito || "—"}</span>
                        )}
                      </td>

                      {/* Escopo */}
                      <td data-label="Escopo" style={TDv}>
                        <ScopeBadge scope={h.scope} />
                      </td>

                      {/* Uso */}
                      <td data-label="Uso" style={{ ...TDv, color: PANEL.muted, textAlign: "center" }}>
                        {h.usageCount}x
                      </td>

                      {/* Ações */}
                      <td data-label="Ações" style={TDv}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {isEditing ? (
                            <>
                              <Button variant="secondary" type="button" onClick={() => setEditingId(null)} disabled={saving} >
                                Cancelar
                              </Button>
                              <Button type="button" onClick={() => saveEdit(h)} disabled={saving}>
                                {saving ? "Salvando…" : "Salvar"}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="secondary" type="button" onClick={() => startEdit(h)} disabled={!!saving || isDeleting} >
                                Editar
                              </Button>
                              {h.scope === "COMPANY" && (
                                <Button variant="secondary"
                                  type="button"
                                  onClick={() => promoteToGlobal(h)}
                                  disabled={!!saving || isDeleting}
                                  aria-busy={promotingId === h.id || undefined}
                                  title="Disponibilizar para todas as empresas"
                                >
                                  {promotingId === h.id ? "Salvando…" : "→ Global"}
                                </Button>
                              )}
                              <Button variant="danger"
                                type="button"
                                onClick={() => handleDelete(h.id)}
                                disabled={!!saving || isDeleting}
                              >
                                {isDeleting ? "Excluindo…" : "Excluir"}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>

        <p style={{ fontSize: "0.875rem", color: PANEL.muted }}>Históricos Empresa aparecem apenas nesta empresa. Históricos Global aparecem em todas as empresas do escritório.</p>
      </fieldset>
    </Modal>
  );
}
