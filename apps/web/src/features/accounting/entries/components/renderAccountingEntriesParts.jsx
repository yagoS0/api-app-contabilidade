import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { BaixaModal } from "../../baixa/components/renderBaixaModal";
import {
  ACCOUNTING_PANEL,
  INPUT,
  ORIGEM_LABELS,
  PANEL_FIELD_STYLE,
  PANEL_ICON_BUTTON_STYLE,
  PANEL_LABEL_STYLE,
  STATUS_LABELS,
  SUBTIPO_OPTIONS,
  TDv,
  TIPO_LABELS,
  fmtDate,
  fmtMoney,
  getCompRange,
} from "../lib/accountingEntriesShared";

const TIPO_COLOR = {
  DESPESA: { fg: "#F8F8F2", bg: "#44475A", border: "#44475A" },
  ATIVO: { fg: "#1A1B26", bg: "#8BE9FD", border: "#8BE9FD" },
  RECEITA: { fg: "#1A1B26", bg: "#69FF47", border: "#69FF47" },
  PASSIVO: { fg: "#1A1B26", bg: "#FFB347", border: "#FFB347" },
  PATRIMONIO: { fg: "#1A1B26", bg: "#BD93F9", border: "#BD93F9" },
};

function AccountSuggestionRow({ account, onClick, rowRef, selected, onHover }) {
  const isDevedora = account.natureza === "DEVEDORA";
  const tc = TIPO_COLOR[account.tipo] || TIPO_COLOR.DESPESA;
  return (
    <button
      ref={rowRef}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      onMouseEnter={onHover}
      style={{
        display: "grid", gridTemplateColumns: "1fr auto",
        alignItems: "center", gap: 8,
        width: "100%", textAlign: "left",
        padding: "8px 10px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`,
        background: selected ? ACCOUNTING_PANEL.surface : ACCOUNTING_PANEL.field,
        border: "none", color: ACCOUNTING_PANEL.text,
        outline: selected ? "2px solid #69FF47" : "none",
        outlineOffset: "-2px", cursor: "pointer",
      }}
    >
      <div>
        <div style={{ fontSize: "0.8125rem", fontWeight: 600, marginBottom: 2 }}>{account.nome}</div>
        <div style={{ fontSize: "0.7rem", color: ACCOUNTING_PANEL.muted }}>
          <span style={{ fontWeight: 700, color: isDevedora ? "#8BE9FD" : "#69FF47" }}>
            {isDevedora ? `D ${account.codigo}` : `C ${account.codigo}`}
          </span>
        </div>
      </div>
      <span style={{ fontSize: "0.6rem", padding: "1px 6px", borderRadius: 999, fontWeight: 700, flexShrink: 0, background: tc.bg, color: tc.fg, border: `1px solid ${tc.border}` }}>
        {account.tipo}
      </span>
    </button>
  );
}

function HistoricoSuggestionRow({ item, onClick, rowRef, selected, onHover }) {
  return (
    <button
      ref={rowRef}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      onMouseEnter={onHover}
      style={{
        display: "grid", gridTemplateColumns: "1fr auto",
        alignItems: "center", gap: 8,
        width: "100%", textAlign: "left",
        padding: "8px 10px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`,
        background: selected ? ACCOUNTING_PANEL.surface : ACCOUNTING_PANEL.field,
        border: "none", color: ACCOUNTING_PANEL.text,
        outline: selected ? "2px solid #BD93F9" : "none",
        outlineOffset: "-2px", cursor: "pointer",
      }}
    >
      <div>
        <div style={{ fontSize: "0.8125rem", fontWeight: 600, marginBottom: 2 }}>{item.text}</div>
        <div style={{ display: "flex", gap: 12, fontSize: "0.7rem", color: ACCOUNTING_PANEL.muted }}>
          {item.contaDebito && <span><span style={{ fontWeight: 700, color: "#8BE9FD" }}>D {item.contaDebito}</span></span>}
          {item.contaCredito && <span><span style={{ fontWeight: 700, color: "#69FF47" }}>C {item.contaCredito}</span></span>}
        </div>
      </div>
      <span style={{ fontSize: "0.6rem", padding: "1px 6px", borderRadius: 999, fontWeight: 700, flexShrink: 0, background: item.scope === "GLOBAL" ? "#44475A" : "#BD93F9", color: item.scope === "GLOBAL" ? "#F8F8F2" : "#1A1B26", border: "none" }}>
        {item.scope === "GLOBAL" ? "Global" : "Empresa"}
      </span>
    </button>
  );
}

function SectionLabel({ children }) {
  return <div style={{ padding: "8px 10px", fontSize: "0.65rem", fontWeight: 700, color: ACCOUNTING_PANEL.muted, borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, textTransform: "uppercase", letterSpacing: "0.06em", background: ACCOUNTING_PANEL.surface }}>{children}</div>;
}

function StatusChip({ status }) {
  const map = {
    RASCUNHO: { bg: "#FFB347", color: "#1A1B26", border: "#FFB347" },
    CONFIRMADO: { bg: "#69FF47", color: "#1A1B26", border: "#69FF47" },
    EXPORTADO: { bg: "#BD93F9", color: "#1A1B26", border: "#BD93F9" },
  };
  const style = map[status] || map.RASCUNHO;
  return <span style={{ display: "inline-block", fontSize: "0.8125rem", fontWeight: 700, padding: "6px 12px", borderRadius: 999, background: style.bg, color: style.color, border: `1px solid ${style.border}`, whiteSpace: "nowrap" }}>{STATUS_LABELS[status] || status}</span>;
}

function TemplateBadge() {
  return <span style={{ display: "inline-block", fontSize: "0.8125rem", fontWeight: 700, padding: "6px 12px", borderRadius: 999, background: "#FFB347", color: "#1A1B26", border: "1px solid #FFB347", whiteSpace: "nowrap" }}>PREENCHER VALOR</span>;
}

function PagamentoChip({ status }) {
  const map = {
    ABERTO: { bg: "#FF4757", color: "#F8F8F2", border: "#FF4757", label: "ABERTO" },
    PAGO: { bg: "#69FF47", color: "#1A1B26", border: "#69FF47", label: "PAGO" },
  };
  const style = map[status];
  if (!style) return null;
  return <span style={{ display: "inline-block", fontSize: "0.8125rem", fontWeight: 700, padding: "6px 12px", borderRadius: 999, background: style.bg, color: style.color, border: `1px solid ${style.border}`, whiteSpace: "nowrap", marginLeft: 4 }}>{style.label}</span>;
}

function LineEditor({ lines, onChange, accounts }) {
  function updateLine(idx, field, val) { onChange(lines.map((l, i) => i === idx ? { ...l, [field]: val } : l)); }
  function removeLine(idx) { onChange(lines.filter((_, i) => i !== idx)); }
  function addLine(tipo) { onChange([...lines, { tipo, conta: "", valor: "" }]); }
  const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
  const diff = Math.abs(totalD - totalC);
  const balanced = diff < 0.01;
  const lineStyle = { display: "grid", gridTemplateColumns: "38px 90px 1fr 110px 28px", gap: 4, alignItems: "center", padding: "3px 0", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}` };

  return (
    <div style={{ marginTop: 6, padding: 12, borderRadius: 8, background: ACCOUNTING_PANEL.field }}>
      <div style={{ display: "grid", gridTemplateColumns: "38px 90px 1fr 110px 28px", gap: 4, padding: "2px 0", fontSize: "0.6rem", fontWeight: 700, color: ACCOUNTING_PANEL.muted, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}` }}>
        <span>D/C</span><span>Conta</span><span>Nome</span><span style={{ textAlign: "right" }}>Valor (R$)</span><span></span>
      </div>
      {lines.map((l, idx) => {
        const resolved = accounts.find((a) => a.codigo === String(l.conta || "").trim());
        return (
          <div key={idx} style={lineStyle}>
            <select value={l.tipo} onChange={(e) => updateLine(idx, "tipo", e.target.value)} style={{ ...PANEL_FIELD_STYLE, width: "100%", height: 34, padding: "0 6px", fontWeight: 700, color: l.tipo === "D" ? "#8BE9FD" : "#69FF47", background: ACCOUNTING_PANEL.surface }}><option value="D">D</option><option value="C">C</option></select>
            <input type="text" value={l.conta || ""} placeholder="Cód." onChange={(e) => updateLine(idx, "conta", e.target.value)} style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", fontWeight: 700 }} />
            <div style={{ fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: resolved ? ACCOUNTING_PANEL.text : ACCOUNTING_PANEL.muted, paddingLeft: 2 }}>{resolved ? resolved.nome : "—"}</div>
            <input type="number" step="0.01" min="0" placeholder="0,00" value={l.valor || ""} onChange={(e) => updateLine(idx, "valor", e.target.value)} style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", textAlign: "right" }} />
            <button onClick={() => removeLine(idx)} style={{ width: 24, height: 24, border: "none", background: "#FF4757", color: "#F8F8F2", borderRadius: 3, cursor: "pointer", fontSize: "0.7rem", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => addLine("D")} style={{ ...PANEL_FIELD_STYLE, width: "auto", height: 32, padding: "0 12px", cursor: "pointer" }}>+ D</button>
        <button type="button" onClick={() => addLine("C")} style={{ ...PANEL_FIELD_STYLE, width: "auto", height: 32, padding: "0 12px", cursor: "pointer" }}>+ C</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", fontSize: "0.8rem" }}>
          <span>Débitos: <strong style={{ color: "#8BE9FD" }}>R$ {fmtMoney(totalD)}</strong></span>
          <span>Créditos: <strong style={{ color: "#69FF47" }}>R$ {fmtMoney(totalC)}</strong></span>
          {balanced ? <span style={{ color: "#69FF47", fontWeight: 700 }}>Balanceado</span> : <span style={{ color: "#FF4757", fontWeight: 700 }}>Diferença: R$ {fmtMoney(diff)}</span>}
        </div>
      </div>
    </div>
  );
}

function detectSubtipoFromNome(nome) {
  const n = String(nome || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n.includes("SIMPLES") || n.includes("DAS")) return "DAS";
  if (n.includes("IRRF") || (n.includes("IMPOSTO") && n.includes("RENDA"))) return "IRRF";
  if (n.includes("ISS")) return "ISS";
  if (n.includes("PIS") || n.includes("COFINS")) return "PIS_COFINS";
  if (n.includes("FGTS")) return "FGTS";
  if (n.includes("FERI")) return "FERIAS";
  if (n.includes("13") || n.includes("DECIMO") || n.includes("NATALINO")) return "DECIMO_TERCEIRO";
  return "OUTROS_TRIBUTOS";
}

function detectTipoFromAccounts(contaD, contaC, accounts) {
  const accD = accounts.find((a) => a.codigo === String(contaD || "").trim());
  const accC = accounts.find((a) => a.codigo === String(contaC || "").trim());
  if (!accD && !accC) return { tipo: "DESPESA", subtipo: null };
  if (accC?.tipo === "RECEITA") return { tipo: "RECEITA", subtipo: null };
  if (accC?.tipo === "PASSIVO") {
    const n = String(accC.nome || "").toUpperCase();
    const isProvisao = /RECOLHER|PROVISAO|SIMPLES|DAS|IRRF|ISS|FGTS|PIS|COFINS|FERIAS|SALARIO|IMPOSTO|TRIBUT/.test(n);
    if (isProvisao) return { tipo: "PROVISAO", subtipo: detectSubtipoFromNome(accC.nome) };
  }
  if (accD) {
    const nd = String(accD.nome || "").toUpperCase();
    const isProvDed = /DAS|SIMPLES|IRRF|ISS|FGTS|PIS|COFINS/.test(nd);
    if (isProvDed && accC?.tipo === "PASSIVO") return { tipo: "PROVISAO", subtipo: detectSubtipoFromNome(accD.nome) };
  }
  if (accD?.tipo === "DESPESA") return { tipo: "DESPESA", subtipo: null };
  if (accD?.tipo === "RECEITA") return { tipo: "RECEITA", subtipo: null };
  return { tipo: "DESPESA", subtipo: null };
}

function AccountCodeInput({ id, value, onChange, onKeyDown, accounts, onGetHistoricosByCode, onSelectHistorico, placeholder, inputRef }) {
  const [open, setOpen] = useState(false);
  const [historicos, setHistoricos] = useState([]);
  const ref = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    const v = String(value || "").trim();
    if (!onGetHistoricosByCode || v.length < 1) { setHistoricos([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await onGetHistoricosByCode(v);
        setHistoricos(Array.isArray(results) ? results : []);
        if (results.length > 0) setOpen(true);
      } catch {}
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [value, onGetHistoricosByCode]);

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <div ref={ref} style={{ flexShrink: 0, position: "relative", minWidth: 0 }}>
      <input ref={inputRef} id={id} type="text" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} onKeyDown={onKeyDown} onFocus={() => historicos.length > 0 && setOpen(true)} placeholder={placeholder || "Cód."} autoComplete="off" style={{ ...PANEL_FIELD_STYLE, padding: "0 8px", textAlign: "center" }} />
      {open && historicos.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, zIndex: 300, background: ACCOUNTING_PANEL.field, border: `1px solid ${ACCOUNTING_PANEL.border}`, borderRadius: 6, boxShadow: "0 8px 28px rgba(0,0,0,0.15)", minWidth: 300, maxHeight: 220, overflowY: "auto" }}>
          <SectionLabel>Históricos do código {value}</SectionLabel>
          {historicos.map((h, i) => (
            <button key={h.id || i} onMouseDown={(e) => { e.preventDefault(); onSelectHistorico?.(h.text, h.contaDebito, h.contaCredito); setOpen(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, background: ACCOUNTING_PANEL.field, border: "none", cursor: "pointer", color: ACCOUNTING_PANEL.text }} onMouseEnter={(e) => { e.currentTarget.style.background = ACCOUNTING_PANEL.surface; }} onMouseLeave={(e) => { e.currentTarget.style.background = ACCOUNTING_PANEL.field; }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{h.text}</div>
              <div style={{ fontSize: "0.65rem", color: ACCOUNTING_PANEL.muted, display: "flex", gap: 6, alignItems: "center" }}>
                {h.contaDebito && <span style={{ color: "#8BE9FD", fontWeight: 700 }}>D:{h.contaDebito}</span>}
                {h.contaCredito && <span style={{ color: "#69FF47", fontWeight: 700 }}>C:{h.contaCredito}</span>}
                <span style={{ fontSize: "0.6rem", padding: "1px 5px", borderRadius: 999, background: h.scope === "GLOBAL" ? "#44475A" : "#BD93F9", color: h.scope === "GLOBAL" ? "#F8F8F2" : "#1A1B26" }}>{h.scope === "GLOBAL" ? "Global" : "Empresa"}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SmartHistoricoInput({ value, onChange, onFillFromHistory, onSearchHistoricos, accounts, inputRef, inputStyle }) {
  const [open, setOpen] = useState(false);
  const [historicos, setHistoricos] = useState([]);
  const [selIdx, setSelIdx] = useState(-1);
  const ref = useRef(null);
  const itemRefs = useRef([]);
  const debounceRef = useRef(null);
  const accts = useMemo(() => {
    const q = value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (q.length < 2 || !Array.isArray(accounts) || accounts.length === 0) return [];
    return accounts.filter((a) => String(a.nome || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q)).slice(0, 6);
  }, [value, accounts]);

  useEffect(() => {
    if (!onSearchHistoricos || value.trim().length < 2) { setHistoricos([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => { try { const results = await onSearchHistoricos(value.trim()); setHistoricos(Array.isArray(results) ? results : []); } catch {} }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [value, onSearchHistoricos]);

  const allItems = useMemo(() => [...historicos.map((h) => ({ _type: "historico", ...h })), ...accts.map((a) => ({ _type: "account", ...a }))], [historicos, accts]);
  useEffect(() => { if (allItems.length > 0 && value.trim().length >= 2) setOpen(true); }, [allItems.length, value]);
  useEffect(() => { if (selIdx >= 0 && itemRefs.current[selIdx]) itemRefs.current[selIdx].scrollIntoView({ block: "nearest" }); }, [selIdx]);
  useEffect(() => { setSelIdx(-1); }, [allItems.length]);

  function selectItem(item) {
    if (item._type === "historico") {
      const lines = [];
      if (item.contaDebito) lines.push({ tipo: "D", conta: item.contaDebito, valor: "" });
      if (item.contaCredito) lines.push({ tipo: "C", conta: item.contaCredito, valor: "" });
      onFillFromHistory(item.text, lines.length ? lines : null);
    } else {
      const lines = item.natureza === "DEVEDORA" ? [{ tipo: "D", conta: item.codigo, valor: "" }] : [{ tipo: "C", conta: item.codigo, valor: "" }];
      onFillFromHistory(item.nome, lines);
    }
    setOpen(false);
    setSelIdx(-1);
  }

  function handleKeyDown(e) {
    if (!open || allItems.length === 0) {
      if (e.key === "ArrowDown" && allItems.length > 0) { setOpen(true); setSelIdx(0); e.preventDefault(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx((i) => Math.min(i + 1, allItems.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && selIdx >= 0) { e.preventDefault(); e.stopPropagation(); selectItem(allItems[selIdx]); }
    else if (e.key === "Escape") { setOpen(false); setSelIdx(-1); }
  }

  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <input ref={inputRef} type="text" value={value} placeholder="Histórico do lançamento..." onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => allItems.length > 0 && setOpen(true)} onKeyDown={handleKeyDown} style={{ ...PANEL_FIELD_STYLE, fontSize: "1.0625rem", fontWeight: 500, ...inputStyle }} />
      {open && allItems.length > 0 && (
        <div style={{ position: "absolute", top: "calc(100% + 3px)", left: 0, zIndex: 300, background: ACCOUNTING_PANEL.field, border: `1px solid ${ACCOUNTING_PANEL.border}`, borderRadius: 6, boxShadow: "0 8px 28px rgba(0,0,0,0.15)", minWidth: 480, maxHeight: 360, overflowY: "auto" }}>
          {historicos.length > 0 && <><SectionLabel>Históricos salvos — ↑↓ Enter para selecionar</SectionLabel>{historicos.map((h, i) => <HistoricoSuggestionRow key={h.id || i} rowRef={(el) => (itemRefs.current[i] = el)} selected={selIdx === i} item={h} onClick={() => selectItem({ _type: "historico", ...h })} onHover={() => setSelIdx(i)} />)}</>}
          {accts.length > 0 && <><SectionLabel>Plano de contas</SectionLabel>{accts.map((a, i) => { const globalIdx = historicos.length + i; return <AccountSuggestionRow key={a.codigo} rowRef={(el) => (itemRefs.current[globalIdx] = el)} selected={selIdx === globalIdx} account={a} onClick={() => selectItem({ _type: "account", ...a })} onHover={() => setSelIdx(globalIdx)} />; })}</>}
        </div>
      )}
    </div>
  );
}

export function NewEntryForm({ accounts, onSave, saving, activeComp, onSearchHistoricos, onGetHistoricosByCode, listedTotalD, listedTotalC }) {
  const { min, max, defaultDate } = getCompRange(activeComp);
  const entryFontSize = "20px";
  const [dayStr, setDayStr] = useState(() => defaultDate ? String(Number(defaultDate.slice(8))) : "");
  const [dateVal, setDateVal] = useState(defaultDate);
  const [contaD, setContaD] = useState("");
  const [contaC, setContaC] = useState("");
  const [historico, setHistorico] = useState("");
  const [valor, setValor] = useState("");
  const [complexMode, setComplexMode] = useState(false);
  const [complexLines, setComplexLines] = useState([{ tipo: "D", conta: "", valor: "" }, { tipo: "C", conta: "", valor: "" }]);
  const dayRef = useRef(null);
  const dRef = useRef(null);
  const cRef = useRef(null);
  const histRef = useRef(null);
  const valRef = useRef(null);

  useEffect(() => {
    const { defaultDate: nd } = getCompRange(activeComp);
    setDateVal(nd);
    setDayStr(nd ? String(Number(nd.slice(8))) : "");
  }, [activeComp]);

  function handleDayChange(raw) {
    setDayStr(raw);
    if (raw === "" || raw === "0") { setDateVal(""); return; }
    const maxDay = max ? Number(max.slice(8)) : 31;
    const day = Math.max(1, Math.min(maxDay, Number(raw)));
    if (isNaN(day)) return;
    const [y, m] = (min || "").split("-");
    if (y && m) setDateVal(`${y}-${m}-${String(day).padStart(2, "0")}`);
  }

  const detected = useMemo(() => detectTipoFromAccounts(contaD, contaC, accounts), [contaD, contaC, accounts]);
  const simpleLines = [{ tipo: "D", conta: contaD, valor }, { tipo: "C", conta: contaC, valor }];
  const activeLines = complexMode ? complexLines : simpleLines;
  const totalD = activeLines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalC = activeLines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
  const balanced = Math.abs(totalD - totalC) < 0.01 && totalD > 0;
  const listedBalanceDelta = Number(listedTotalD || 0) - Number(listedTotalC || 0);
  const canSave = dateVal && historico && balanced && !saving;

  function reset() {
    setContaD(""); setContaC(""); setHistorico(""); setValor(""); setComplexMode(false); setComplexLines([{ tipo: "D", conta: "", valor: "" }, { tipo: "C", conta: "", valor: "" }]);
    const { defaultDate: nd } = getCompRange(activeComp);
    setDateVal(nd); setDayStr(nd ? String(Number(nd.slice(8))) : "");
    setTimeout(() => dayRef.current?.focus(), 30);
  }

  async function handleSave() {
    if (!canSave) return;
    const payload = { data: dateVal, historico, tipo: detected.tipo, lines: activeLines.map((l, i) => ({ conta: l.conta, tipo: l.tipo, valor: Number(l.valor || 0), ordem: i })) };
    if (detected.tipo === "PROVISAO") payload.subtipo = detected.subtipo;
    await onSave(payload);
    reset();
  }

  const [labelY, labelM] = activeComp ? activeComp.split("-") : ["", ""];
  const monthLabel = activeComp ? new Date(Number(labelY), Number(labelM) - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : "";
  const tipoDetectadoLabel = detected.tipo === "PROVISAO" ? `Provisão · ${SUBTIPO_OPTIONS.find((o) => o.key === detected.subtipo)?.label || detected.subtipo || ""}` : TIPO_LABELS[detected.tipo] || detected.tipo;
  const hasConta = contaD || contaC;
  const totalCard = { display: "grid", gap: 2, padding: 8, borderRadius: 8, background: ACCOUNTING_PANEL.field, minWidth: 150, justifyItems: "center", textAlign: "center" };

  return (
    <div style={{ background: ACCOUNTING_PANEL.surface, borderRadius: 12, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 30, alignItems: "flex-end", flex: "1 1 860px", minWidth: 280, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "110px minmax(220px, 1fr) 72px 72px 90px", flex: "1 1 640px", minWidth: 280 }}>
            <label style={PANEL_LABEL_STYLE}><span>Data</span><input ref={dayRef} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Dia" value={dayStr} onChange={(e) => handleDayChange(e.target.value.replace(/\D/g, ""))} onBlur={() => { if (dayStr && Number(dayStr) > 0) handleDayChange(dayStr); }} onKeyDown={(e) => { if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); histRef.current?.focus(); } }} style={{ ...PANEL_FIELD_STYLE, textAlign: "center", fontSize: entryFontSize, fontWeight: 500 }} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Histórico</span><SmartHistoricoInput value={historico} onChange={setHistorico} onFillFromHistory={(hist, histLines) => { if (hist) setHistorico(hist); if (histLines?.length) { const d = histLines.find((l) => l.tipo === "D"); const c = histLines.find((l) => l.tipo === "C"); if (d?.conta) setContaD(d.conta); if (c?.conta) setContaC(c.conta); if (d?.valor) setValor(String(d.valor)); } }} onSearchHistoricos={onSearchHistoricos} accounts={accounts} inputRef={histRef} inputStyle={{ fontSize: entryFontSize, fontWeight: 500 }} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Débito</span><AccountCodeInput id="new-conta-d" value={contaD} onChange={setContaD} onKeyDown={(e) => { if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); cRef.current?.focus(); } }} accounts={accounts} onGetHistoricosByCode={onGetHistoricosByCode} onSelectHistorico={(text, cD, cC) => { if (text) setHistorico(text); if (cD) setContaD(cD); if (cC) setContaC(cC); }} placeholder="D" inputRef={dRef} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Crédito</span><AccountCodeInput id="new-conta-c" value={contaC} onChange={setContaC} onKeyDown={(e) => { if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); valRef.current?.focus(); } }} accounts={accounts} onGetHistoricosByCode={onGetHistoricosByCode} onSelectHistorico={(text, cD, cC) => { if (text) setHistorico(text); if (cD) setContaD(cD); if (cC) setContaC(cC); }} placeholder="C" inputRef={cRef} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Valor</span><input ref={valRef} type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} placeholder="R$ 0,00" style={{ ...PANEL_FIELD_STYLE, textAlign: "right", fontSize: "1.0625rem", fontWeight: 500 }} /></label>
          </div>
          <button type="button" onClick={handleSave} disabled={!canSave} title={!dateVal ? "Informe o dia" : !historico ? "Informe o histórico" : !balanced ? "Valor ou contas incompletos" : "Enter"} style={{ minHeight: 41, padding: "10px 18px", border: "none", borderRadius: 8, background: canSave ? "#69FF47" : "#4b5563", color: "#1A1B26", font: "inherit", fontSize: entryFontSize, fontWeight: 600, cursor: canSave ? "pointer" : "not-allowed", alignSelf: "end" }}>{saving ? "..." : "Salvar"}</button>
        </div>
        <div style={{ display: "grid", gap: 4, minWidth: 150, width: 150, paddingTop: 16 }}>
          <div style={totalCard}><span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#69FF47" }}>Débito</span><span style={{ fontSize: "0.9375rem", fontWeight: 700, color: ACCOUNTING_PANEL.text }}>R$ {fmtMoney(listedTotalD)}</span></div>
          <div style={totalCard}><span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#FF4757" }}>Crédito</span><span style={{ fontSize: "0.9375rem", fontWeight: 700, color: ACCOUNTING_PANEL.text }}>R$ {fmtMoney(listedTotalC)}</span></div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.875rem", color: listedBalanceDelta >= 0 ? "#69FF47" : "#FF4757", fontWeight: 600 }}>Diferença: R$ {fmtMoney(listedBalanceDelta)}</span>
        {monthLabel ? <span style={{ fontSize: "0.8125rem", color: ACCOUNTING_PANEL.muted }}>{monthLabel}</span> : null}
      </div>
      {hasConta && <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: ACCOUNTING_PANEL.muted }}><span>Tipo detectado:</span><span style={{ fontWeight: 700, color: "#1A1B26", background: detected.tipo === "PROVISAO" ? "#FFB347" : detected.tipo === "RECEITA" ? "#69FF47" : "#BD93F9", border: "none", borderRadius: 999, padding: "4px 10px" }}>{tipoDetectadoLabel}</span></div>}
      {complexMode && <div style={{ marginTop: 8 }}><LineEditor lines={complexLines} onChange={setComplexLines} accounts={accounts} /></div>}
    </div>
  );
}

export function AccountRow({ entry, accounts, onUpdate, onDelete, saving, onCreateBaixa, savingBaixa, onSearchHistoricos }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState(null);
  const [showBaixa, setShowBaixa] = useState(false);
  const exported = entry.status === "EXPORTADO";
  const isTemplate = entry.origem === "TEMPLATE" || entry.placeholder === true;
  const lines = entry.lines || [];
  const totalD = entry.totalD ?? lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
  const dCount = lines.filter((l) => l.tipo === "D").length;
  const cCount = lines.filter((l) => l.tipo === "C").length;
  const hasDebitColumn = lines.some((l) => l.tipo === "D" && String(l.conta || "").trim());
  const hasCreditColumn = lines.some((l) => l.tipo === "C" && String(l.conta || "").trim());
  const isIncompleteSides = !hasDebitColumn || !hasCreditColumn;
  const isSimple = dCount === 1 && cCount === 1;
  const dLine = lines.find((l) => l.tipo === "D");
  const cLine = lines.find((l) => l.tipo === "C");
  const dA = dLine ? accounts.find((a) => a.codigo === dLine.conta) : null;
  const cA = cLine ? accounts.find((a) => a.codigo === cLine.conta) : null;
  const incompleteRowStyle = isIncompleteSides ? { outline: "2px solid #8BE9FD", outlineOffset: "-2px" } : null;

  function startEdit() {
    setForm({ data: entry.data ? entry.data.slice(0, 10) : "", historico: entry.historico, tipo: entry.tipo, subtipo: entry.subtipo || "", lines: lines.map((l) => ({ tipo: l.tipo, conta: l.conta, valor: String(Number(l.valor).toFixed(2)) })) });
    setEditing(true);
  }

  async function save() { await onUpdate(entry.id, form); setEditing(false); setForm(null); }

  if (editing && form) {
    return (
      <tr style={{ background: ACCOUNTING_PANEL.field }}>
        <td style={TDv}><input type="date" value={form.data} onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))} style={{ ...PANEL_FIELD_STYLE, colorScheme: "dark" }} /></td>
        <td style={{ ...TDv, position: "relative" }} colSpan={4}>
          <div style={{ marginBottom: 4 }}><SmartHistoricoInput value={form.historico} onChange={(v) => setForm((p) => ({ ...p, historico: v }))} onFillFromHistory={(h, ls) => setForm((p) => ({ ...p, historico: h, lines: ls?.length ? ls.map((l) => ({ tipo: l.tipo, conta: l.conta || "", valor: l.valor ? String(l.valor) : "" })) : p.lines }))} onSearchHistoricos={onSearchHistoricos} /></div>
          {isTemplate && <div style={{ background: "#FFB347", border: "none", borderRadius: 8, padding: "6px 10px", marginBottom: 6, fontSize: "0.8rem", color: "#1A1B26" }}>Este lançamento foi agendado automaticamente. Preencha as contas e o valor para confirmá-lo.</div>}
          <LineEditor lines={form.lines} onChange={(ls) => setForm((p) => ({ ...p, lines: ls }))} accounts={accounts} />
        </td>
        <td style={TDv}>
          <select value={form.tipo} onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value, subtipo: e.target.value !== "PROVISAO" ? "" : p.subtipo }))} style={{ ...PANEL_FIELD_STYLE, colorScheme: "dark" }}>{Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {form.tipo === "PROVISAO" && <select value={form.subtipo || ""} onChange={(e) => setForm((p) => ({ ...p, subtipo: e.target.value }))} style={{ ...PANEL_FIELD_STYLE, marginTop: 4, colorScheme: "dark" }}><option value="">Subtipo...</option>{SUBTIPO_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select>}
        </td>
        <td style={TDv} colSpan={2}><div style={{ display: "flex", gap: 4 }}><Button size="lg" variant="success" onClick={save} disabled={saving}>{saving ? "..." : "Salvar"}</Button><Button size="sm" variant="secondary" onClick={() => { setEditing(false); setForm(null); }}>Cancelar</Button></div></td>
      </tr>
    );
  }

  const rowBg = ACCOUNTING_PANEL.field;
  const rowBgHover = "#202334";
  return (
    <>
      <tr style={{ background: rowBg, ...incompleteRowStyle }} onMouseEnter={(e) => (e.currentTarget.style.background = rowBgHover)} onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}>
        <td style={{ ...TDv, fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtDate(entry.data)}</td>
        <td style={{ ...TDv, textAlign: isSimple ? "center" : "left" }} colSpan={isSimple ? 1 : 2}>
          {isSimple ? <><span style={{ display: "block", textAlign: "center", fontWeight: 700, fontSize: "0.9375rem" }}>{dLine?.conta}</span>{dA && <div style={{ fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>{dA.nome}</div>}</> : <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: "0.875rem", color: ACCOUNTING_PANEL.muted }}>{dCount}D / {cCount}C</span><button onClick={() => setExpanded((v) => !v)} style={{ fontSize: "0.75rem", background: ACCOUNTING_PANEL.surface, border: `1px solid ${ACCOUNTING_PANEL.border}`, color: ACCOUNTING_PANEL.text, borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>{expanded ? "▼" : "▶"}</button></div>}
        </td>
        {isSimple && <td style={{ ...TDv, textAlign: "center" }}><span style={{ display: "block", textAlign: "center", fontWeight: 700, fontSize: "0.9375rem" }}>{cLine?.conta}</span>{cA && <div style={{ fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>{cA.nome}</div>}</td>}
        <td style={{ ...TDv, fontSize: "0.9375rem" }} title={entry.historico}><div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.historico || "—"}</div>{isTemplate ? <span style={{ fontSize: "0.7rem", color: "#1A1B26", background: "#FFB347", padding: "2px 7px", borderRadius: 999 }}>agendado</span> : entry.origem !== "MANUAL" && <span style={{ fontSize: "0.7rem", color: ACCOUNTING_PANEL.text, background: ACCOUNTING_PANEL.surface, padding: "2px 7px", borderRadius: 999 }}>{ORIGEM_LABELS[entry.origem] || entry.origem}</span>}</td>
        <td style={{ ...TDv, textAlign: "right", fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{isTemplate ? <span style={{ color: ACCOUNTING_PANEL.muted, fontSize: "0.875rem" }}>—</span> : fmtMoney(totalD)}</td>
        <td style={{ ...TDv, fontSize: "0.875rem", color: ACCOUNTING_PANEL.text }}>{TIPO_LABELS[entry.tipo] || entry.tipo}</td>
        <td style={TDv}>{isTemplate ? <TemplateBadge /> : <><StatusChip status={entry.status} />{entry.tipo === "PROVISAO" && <PagamentoChip status={entry.statusPagamento} />}</>}</td>
        <td style={{ ...TDv, textAlign: "right", borderRight: "none" }}><div style={{ display: "flex", gap: 3, justifyContent: "flex-end", flexWrap: "wrap" }}>{entry.tipo === "PROVISAO" && entry.statusPagamento === "ABERTO" && !isTemplate && onCreateBaixa && <Button size="sm" variant="primary" onClick={() => setShowBaixa(true)} disabled={saving || savingBaixa}>Dar Baixa</Button>}{!exported && <><button type="button" onClick={startEdit} disabled={saving} style={{ ...PANEL_ICON_BUTTON_STYLE, background: "#BD93F9" }}>✎</button><button type="button" onClick={() => onDelete(entry.id)} disabled={saving} style={{ ...PANEL_ICON_BUTTON_STYLE, background: "#FF4757" }}>⌫</button></>}</div></td>
      </tr>
      {expanded && !isSimple && <tr style={{ background: ACCOUNTING_PANEL.surface }}><td colSpan={8} style={{ padding: "6px 16px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}` }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}><thead><tr><th style={{ textAlign: "left", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>D/C</th><th style={{ textAlign: "left", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>Conta</th><th style={{ textAlign: "left", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>Nome</th><th style={{ textAlign: "right", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>Valor</th></tr></thead><tbody>{lines.map((l, i) => { const acc = accounts.find((a) => a.codigo === l.conta); return <tr key={i}><td style={{ padding: "2px 6px", fontWeight: 700, color: l.tipo === "D" ? "#8BE9FD" : "#69FF47" }}>{l.tipo}</td><td style={{ padding: "2px 6px", fontWeight: 700 }}>{l.conta}</td><td style={{ padding: "2px 6px", color: ACCOUNTING_PANEL.muted }}>{acc?.nome || "—"}</td><td style={{ padding: "2px 6px", textAlign: "right" }}>{fmtMoney(l.valor)}</td></tr>; })}</tbody></table></td></tr>}
      {showBaixa && <BaixaModal entry={entry} accounts={accounts} saving={savingBaixa} onSave={async (input) => { await onCreateBaixa(entry.id, input); setShowBaixa(false); }} onClose={() => setShowBaixa(false)} />}
    </>
  );
}
