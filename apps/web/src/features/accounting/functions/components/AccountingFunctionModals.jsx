// 3 modais coexistindo neste arquivo (escopo pequeno + acoplados):
//   - FunctionListModal: lista funções (GLOBAL + empresa), com botões Aplicar/Editar/Excluir/Nova/Duplicar.
//   - FunctionEditModal: editor de função (nome, entries com histórico + lines D/C com AccountSearchInput).
//   - FunctionApplyModal: contador preenche valor (e opcionalmente data) por entry e aplica.

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";

// Estilos básicos (consistentes com o restante do app)
const PANEL = {
  surface: "#21222C", field: "#282A36", border: "#44475A",
  text: "#F8F8F2", muted: "#aeb6d3",
};
const FIELD = { background: PANEL.field, border: `1px solid ${PANEL.border}`, color: PANEL.text, borderRadius: 6, padding: "6px 10px", fontSize: "0.85rem", width: "100%" };

function formatLastDayOfCompetencia(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return "";
  const y = Number(m[1]); const mo = Number(m[2]);
  const d = new Date(Date.UTC(y, mo, 0));
  return d.toISOString().slice(0, 10);
}

// Input com autocomplete por código OU nome (mesma ideia do AccountSearchInput de Lançamentos,
// mas standalone aqui para evitar ciclo de import).
function AccountSearch({ value, onChange, accounts, placeholder }) {
  const [q, setQ] = useState(String(value || ""));
  const [open, setOpen] = useState(false);
  useEffect(() => { setQ(String(value || "")); }, [value]);

  const normalized = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const qN = normalized(q);
  const exactMatch = qN && accounts.some((a) => String(a.codigo).toLowerCase() === qN);
  const matches = (qN && !exactMatch)
    ? accounts.filter((a) =>
        String(a.codigo).toLowerCase().includes(qN) ||
        normalized(a.nome).includes(qN)
      ).slice(0, 10)
    : [];

  function pick(acc) {
    onChange(String(acc.codigo));
    setQ(String(acc.codigo));
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text" value={q} placeholder={placeholder || "Cód. ou nome"} autoComplete="off"
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          if (/^\d+$/.test(v.trim())) onChange(v.trim());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === "Tab") && matches.length > 0) {
            e.preventDefault();
            pick(matches[0]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        style={{ ...FIELD, fontWeight: 700 }}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 2px)", left: 0, zIndex: 2000,
          background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6,
          boxShadow: "0 8px 28px rgba(0,0,0,0.3)", minWidth: 280, maxHeight: 220, overflowY: "auto", overflowX: "hidden",
        }}>
          {matches.map((a) => (
            <button key={a.codigo} type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(a); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "6px 10px", border: "none", background: PANEL.field,
                color: PANEL.text, cursor: "pointer", fontSize: "0.78rem",
                borderBottom: `1px solid ${PANEL.border}`,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = PANEL.surface; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = PANEL.field; }}
            >
              <div style={{ fontWeight: 700 }}>{a.codigo} · {a.nome}</div>
              <div style={{ fontSize: "0.65rem", color: PANEL.muted }}>{a.tipo || "—"}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FunctionListModal — escolha de função para aplicar/editar
// ─────────────────────────────────────────────────────────────────────────
export function FunctionListModal({ functions, loading, onApply, onEdit, onDelete, onCreate, onDuplicate, onClose }) {
  const globals = functions.filter((f) => !f.portalClientId);
  const ownerEmpresa = functions.filter((f) => f.portalClientId);

  function FunctionRow({ f }) {
    const isSystem = Boolean(f.isSystem);
    const isGlobal = !f.portalClientId;
    return (
      <div style={{
        display: "grid", gridTemplateColumns: "1fr auto",
        padding: "10px 12px", borderBottom: `1px solid ${PANEL.border}`,
        alignItems: "center", gap: 8,
      }}>
        <div>
          <div style={{ fontWeight: 700, color: PANEL.text }}>{f.name}</div>
          {f.description && (
            <div style={{ fontSize: "0.75rem", color: PANEL.muted, marginTop: 2 }}>{f.description}</div>
          )}
          <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 4 }}>
            {(f.entries || []).length} lançamento(s)
            <span style={{
              marginLeft: 8, padding: "1px 6px", borderRadius: 999,
              background: isGlobal ? "#44475A" : "#BD93F9",
              color: isGlobal ? "#F8F8F2" : "#1A1B26", fontSize: "0.65rem", fontWeight: 700,
            }}>{isGlobal ? "Global" : "Empresa"}</span>
            {isSystem && (
              <span style={{
                marginLeft: 4, padding: "1px 6px", borderRadius: 999,
                background: "#FFB347", color: "#1A1B26", fontSize: "0.65rem", fontWeight: 700,
              }}>Sistema</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <Button size="sm" variant="primary" onClick={() => onApply(f)}>Aplicar</Button>
          {!isSystem && !isGlobal && (
            <>
              <Button size="sm" variant="secondary" onClick={() => onEdit(f)}>Editar</Button>
              <Button size="sm" variant="danger" onClick={() => onDelete(f)}>Excluir</Button>
            </>
          )}
          {(isSystem || isGlobal) && (
            <Button size="sm" variant="secondary" onClick={() => onDuplicate(f)} title="Duplicar para esta empresa e personalizar">
              Duplicar
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1500,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
        padding: 20, width: "100%", maxWidth: 720, maxHeight: "90vh", overflowY: "auto", overflowX: "hidden",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: PANEL.text, fontSize: "1rem" }}>Funções de Lançamento</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Button variant="primary" onClick={onCreate}>+ Nova função</Button>
        </div>

        {loading && <div style={{ color: PANEL.muted, padding: 20, textAlign: "center" }}>Carregando…</div>}

        {!loading && functions.length === 0 && (
          <div style={{ color: PANEL.muted, padding: 20, textAlign: "center" }}>
            Nenhuma função cadastrada. Clique em "Nova função" para criar a primeira.
          </div>
        )}

        {!loading && globals.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, fontWeight: 700 }}>
              Funções globais (para todas as empresas)
            </div>
            {globals.map((f) => <FunctionRow key={f.id} f={f} />)}
          </div>
        )}

        {!loading && ownerEmpresa.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, fontWeight: 700 }}>
              Funções desta empresa
            </div>
            {ownerEmpresa.map((f) => <FunctionRow key={f.id} f={f} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FunctionEditModal — cria/edita função (sem valor; só estrutura)
// ─────────────────────────────────────────────────────────────────────────
export function FunctionEditModal({ initial, accounts, saving, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [entries, setEntries] = useState(() => (initial?.entries?.length
    ? initial.entries.map((e, idx) => ({
        ordem: idx, historico: e.historico || "",
        tipo: e.tipo || "DESPESA", subtipo: e.subtipo || "",
        lines: (e.lines || []).map((ln, lidx) => ({ ordem: lidx, conta: ln.conta || "", tipo: ln.tipo || "D" })),
      }))
    : [{
        ordem: 0, historico: "",
        tipo: "DESPESA", subtipo: "",
        lines: [{ ordem: 0, conta: "", tipo: "D" }, { ordem: 1, conta: "", tipo: "C" }],
      }]
  ));
  const [err, setErr] = useState(null);

  function updateEntry(idx, patch) { setEntries((p) => p.map((e, i) => i === idx ? { ...e, ...patch } : e)); }
  function removeEntry(idx) { setEntries((p) => p.filter((_, i) => i !== idx)); }
  function addEntry() {
    setEntries((p) => [...p, {
      ordem: p.length, historico: "", tipo: "DESPESA", subtipo: "",
      lines: [{ ordem: 0, conta: "", tipo: "D" }, { ordem: 1, conta: "", tipo: "C" }],
    }]);
  }
  function updateLine(entryIdx, lineIdx, patch) {
    setEntries((p) => p.map((e, i) => i !== entryIdx ? e : ({
      ...e, lines: e.lines.map((l, li) => li === lineIdx ? { ...l, ...patch } : l),
    })));
  }
  function removeLine(entryIdx, lineIdx) {
    setEntries((p) => p.map((e, i) => i !== entryIdx ? e : ({
      ...e, lines: e.lines.filter((_, li) => li !== lineIdx),
    })));
  }
  function addLine(entryIdx, tipo) {
    setEntries((p) => p.map((e, i) => i !== entryIdx ? e : ({
      ...e, lines: [...e.lines, { ordem: e.lines.length, conta: "", tipo }],
    })));
  }

  async function handleSave() {
    setErr(null);
    if (!name.trim()) return setErr("Nome é obrigatório.");
    if (entries.length === 0) return setErr("Adicione pelo menos 1 lançamento.");
    for (const [i, e] of entries.entries()) {
      if (!e.historico.trim()) return setErr(`Lançamento #${i + 1}: histórico obrigatório.`);
      if (!e.lines.some((l) => l.tipo === "D" && String(l.conta || "").trim())) {
        return setErr(`Lançamento #${i + 1}: precisa de pelo menos 1 linha D com conta.`);
      }
      if (!e.lines.some((l) => l.tipo === "C" && String(l.conta || "").trim())) {
        return setErr(`Lançamento #${i + 1}: precisa de pelo menos 1 linha C com conta.`);
      }
    }
    try {
      await onSave({ name: name.trim(), description: description.trim() || null, entries });
    } catch (e) {
      setErr(e?.message || "Falha ao salvar.");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1600,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
        padding: 20, width: "100%", maxWidth: 780, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: PANEL.text }}>{initial ? "Editar função" : "Nova função"}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
            Nome *
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Folha Mensal CLT" style={FIELD} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
            Descrição
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Curta — para tooltip da lista" style={FIELD} />
          </label>

          <div>
            <div style={{ fontSize: "0.75rem", color: PANEL.muted, marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Lançamentos da função
            </div>
            {entries.map((e, idx) => (
              <div key={idx} style={{
                background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8,
                padding: 12, marginBottom: 10,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong style={{ color: PANEL.text, fontSize: "0.85rem" }}>Lançamento #{idx + 1}</strong>
                  {entries.length > 1 && (
                    <Button variant="danger" size="sm" onClick={() => removeEntry(idx)}>
                      Remover
                    </Button>
                  )}
                </div>
                <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted, marginBottom: 8 }}>
                  Histórico (tokens: {`{{competencia}}`}, {`{{companyName}}`}, {`{{cnpj}}`})
                  <input value={e.historico} onChange={(ev) => updateEntry(idx, { historico: ev.target.value })}
                    placeholder="Ex.: FOLHA SALÁRIOS - {{competencia}}" style={FIELD} />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
                    Tipo
                    <select value={e.tipo} onChange={(ev) => updateEntry(idx, { tipo: ev.target.value })} style={FIELD}>
                      <option value="DESPESA">DESPESA</option>
                      <option value="RECEITA">RECEITA</option>
                      <option value="PROVISAO">PROVISAO</option>
                      <option value="FOLHA">FOLHA</option>
                      <option value="BAIXA">BAIXA</option>
                      <option value="OUTRO">OUTRO</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
                    Subtipo (opcional)
                    <input value={e.subtipo} onChange={(ev) => updateEntry(idx, { subtipo: ev.target.value })}
                      placeholder="Ex.: INSS, FGTS, DAS, IRRF" style={FIELD} />
                  </label>
                </div>

                <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginBottom: 4, fontWeight: 700 }}>Linhas (D/C)</div>
                {e.lines.map((ln, lidx) => (
                  <div key={lidx} style={{ display: "grid", gridTemplateColumns: "40px 1fr 24px", gap: 4, marginBottom: 4, alignItems: "center" }}>
                    <select value={ln.tipo} onChange={(ev) => updateLine(idx, lidx, { tipo: ev.target.value })}
                      style={{ ...FIELD, fontWeight: 700, color: ln.tipo === "D" ? "#8BE9FD" : "#69FF47", padding: "6px 4px", textAlign: "center" }}>
                      <option value="D">D</option><option value="C">C</option>
                    </select>
                    <AccountSearch value={ln.conta} onChange={(v) => updateLine(idx, lidx, { conta: v })} accounts={accounts} />
                    {/* ⚠ O `style` que sobrou é SÓ MEDIDA — a cor toda vem do `.btn-danger`. É o
                        mesmo acordo do `.btn-back` no `App.css` ("aqui ficam só as medidas"): a
                        coluna do grid tem 24px e o `.btn-sm` traz `min-height: 32px`, que estouraria
                        a linha. Sem isto o botão não caberia, e é assim que nasce um `btn()` novo. */}
                    <Button variant="danger" size="sm" onClick={() => removeLine(idx, lidx)}
                      style={{ width: 24, minHeight: 30, padding: 0, fontSize: "0.7rem" }}>✕</Button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                  <button onClick={() => addLine(idx, "D")} style={{ ...FIELD, width: "auto", padding: "4px 10px", cursor: "pointer" }}>+ D</button>
                  <button onClick={() => addLine(idx, "C")} style={{ ...FIELD, width: "auto", padding: "4px 10px", cursor: "pointer" }}>+ C</button>
                </div>
              </div>
            ))}
            <Button variant="secondary" onClick={addEntry}>+ Adicionar outro lançamento</Button>
          </div>

          {err && (
            <div style={{ color: "#FF4757", fontSize: "0.8rem", padding: "8px 10px", background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", borderRadius: 6 }}>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Salvando…" : "Salvar função"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FunctionApplyModal — preenche valores e aplica
// ─────────────────────────────────────────────────────────────────────────
export function FunctionApplyModal({ func, defaultCompetencia, saving, onApply, onClose }) {
  const [competencia, setCompetencia] = useState(defaultCompetencia || "");
  const [data, setData] = useState(() => formatLastDayOfCompetencia(defaultCompetencia));
  const [valores, setValores] = useState(() => Object.fromEntries((func?.entries || []).map((e) => [e.id, ""])));
  const [err, setErr] = useState(null);

  useEffect(() => {
    setData(formatLastDayOfCompetencia(competencia));
  }, [competencia]);

  const entriesList = useMemo(() => (func?.entries || []).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)), [func]);

  async function handleApply() {
    setErr(null);
    if (!competencia) return setErr("Selecione a competência.");
    const entryValores = entriesList
      .map((e) => ({ functionEntryId: e.id, valor: Number(valores[e.id]), data: data || undefined }))
      .filter((v) => Number.isFinite(v.valor) && v.valor > 0);
    if (entryValores.length === 0) return setErr("Preencha pelo menos 1 valor (> 0).");
    try {
      await onApply({ competencia, entryValores });
    } catch (e) {
      setErr(e?.message || "Falha ao aplicar.");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1700,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
        padding: 20, width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: PANEL.text }}>Aplicar: {func?.name}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
            Competência (AAAA-MM)
            <input type="text" placeholder="2026-04" value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={FIELD} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
            Data padrão (editável)
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ ...FIELD, colorScheme: "dark" }} />
          </label>
        </div>

        <div style={{ fontSize: "0.7rem", color: PANEL.muted, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>
          Valores por lançamento (deixe vazio para pular)
        </div>
        {entriesList.map((e, idx) => (
          <div key={e.id} style={{
            background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8,
            padding: 10, marginBottom: 8,
          }}>
            <div style={{ fontSize: "0.78rem", color: PANEL.text, fontWeight: 700, marginBottom: 4 }}>
              #{idx + 1} — {e.historico}
            </div>
            <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginBottom: 6 }}>
              {(e.lines || []).map((ln) => `${ln.tipo}:${ln.conta || "—"}`).join(" / ")} · {e.tipo}{e.subtipo ? ` · ${e.subtipo}` : ""}
            </div>
            <input type="number" step="0.01" min="0" placeholder="0,00"
              value={valores[e.id] || ""}
              onChange={(ev) => setValores((p) => ({ ...p, [e.id]: ev.target.value }))}
              style={{ ...FIELD, textAlign: "right" }} />
          </div>
        ))}

        {err && (
          <div style={{ color: "#FF4757", fontSize: "0.8rem", padding: "8px 10px", marginTop: 8, background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", borderRadius: 6 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={handleApply} disabled={saving}>
            {saving ? "Aplicando…" : "Aplicar função"}
          </Button>
        </div>
      </div>
    </div>
  );
}
