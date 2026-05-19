import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
        <div style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: 3 }}>{account.nome}</div>
        <div style={{ fontSize: "0.8125rem", color: ACCOUNTING_PANEL.muted }}>
          <span style={{ fontWeight: 700, color: isDevedora ? "#8BE9FD" : "#69FF47" }}>
            {isDevedora ? `D ${account.codigo}` : `C ${account.codigo}`}
          </span>
        </div>
      </div>
      <span style={{ fontSize: "0.6875rem", padding: "3px 8px", borderRadius: 999, fontWeight: 700, flexShrink: 0, background: tc.bg, color: tc.fg, border: `1px solid ${tc.border}` }}>
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
        <div style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: 3 }}>{item.text}</div>
        <div style={{ display: "flex", gap: 12, fontSize: "0.8125rem", color: ACCOUNTING_PANEL.muted }}>
          {item.contaDebito && <span><span style={{ fontWeight: 700, color: "#8BE9FD" }}>D {item.contaDebito}</span></span>}
          {item.contaCredito && <span><span style={{ fontWeight: 700, color: "#69FF47" }}>C {item.contaCredito}</span></span>}
        </div>
      </div>
      <span style={{ fontSize: "0.6875rem", padding: "3px 8px", borderRadius: 999, fontWeight: 700, flexShrink: 0, background: item.scope === "GLOBAL" ? "#44475A" : "#BD93F9", color: item.scope === "GLOBAL" ? "#F8F8F2" : "#1A1B26", border: "none" }}>
        {item.scope === "GLOBAL" ? "Global" : "Empresa"}
      </span>
    </button>
  );
}

function SectionLabel({ children }) {
  return <div style={{ padding: "10px 12px", fontSize: "0.75rem", fontWeight: 700, color: ACCOUNTING_PANEL.muted, borderBottom: `1px solid ${ACCOUNTING_PANEL.border}`, textTransform: "uppercase", letterSpacing: "0.06em", background: ACCOUNTING_PANEL.surface }}>{children}</div>;
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

export function LineEditor({ lines, onChange, accounts }) {
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
  if (!contaD || !contaC || String(contaD).trim() === String(contaC).trim()) {
    return { tipo: "DESPESA", subtipo: null };
  }

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

export function hasDuplicateAccountAcrossSides(lines) {
  const debitAccounts = new Set(
    (Array.isArray(lines) ? lines : [])
      .filter((line) => String(line.tipo || "").toUpperCase() === "D")
      .map((line) => String(line.conta || "").trim())
      .filter(Boolean)
  );

  return (Array.isArray(lines) ? lines : []).some((line) => {
    if (String(line.tipo || "").toUpperCase() !== "C") return false;
    const accountCode = String(line.conta || "").trim();
    return accountCode && debitAccounts.has(accountCode);
  });
}

export function AccountCodeInput({ id, value, onChange, onKeyDown, accounts, onGetHistoricosByCode, onSelectHistorico, placeholder, inputRef }) {
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

export function SmartHistoricoInput({ value, onChange, onFillFromHistory, onSearchHistoricos, accounts, inputRef, inputStyle, preserveTypedText = false }) {
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
    // Por padrão, ao escolher uma sugestão sobrescrevemos o texto digitado pelo
    // texto da sugestão (histórico salvo ou nome da conta). Quando `preserveTypedText`,
    // passamos o `value` atual — o consumidor mantém o que o usuário já digitou e só
    // aproveita as contas D/C. Útil em telas de texto livre longo (ex: modal OFX onde
    // o contador escreve "PAGO REFEICAO CONFRA EQUIPE" e a sugestão é só atalho para
    // descobrir o código contábil).
    let lines = null;
    if (item._type === "historico") {
      lines = [];
      if (item.contaDebito) lines.push({ tipo: "D", conta: item.contaDebito, valor: "" });
      if (item.contaCredito) lines.push({ tipo: "C", conta: item.contaCredito, valor: "" });
    } else {
      // account
      lines = item.natureza === "DEVEDORA"
        ? [{ tipo: "D", conta: item.codigo, valor: "" }]
        : [{ tipo: "C", conta: item.codigo, valor: "" }];
    }
    const textToPass = preserveTypedText
      ? value
      : (item._type === "historico" ? item.text : item.nome);
    onFillFromHistory(textToPass, lines.length ? lines : null);
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
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 300, background: ACCOUNTING_PANEL.field, border: `1px solid ${ACCOUNTING_PANEL.border}`, borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.2)", minWidth: 620, maxWidth: 760, maxHeight: 440, overflowY: "auto" }}>
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
  const duplicateAcrossSides = hasDuplicateAccountAcrossSides(activeLines);
  const listedBalanceDelta = Number(listedTotalD || 0) - Number(listedTotalC || 0);
  const canSave = dateVal && historico && balanced && !duplicateAcrossSides && !saving;

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
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "110px minmax(220px, 1fr) 72px 72px 140px", flex: "1 1 690px", minWidth: 280 }}>
            <label style={PANEL_LABEL_STYLE}><span>Data</span><input ref={dayRef} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Dia" value={dayStr} onChange={(e) => handleDayChange(e.target.value.replace(/\D/g, ""))} onBlur={() => { if (dayStr && Number(dayStr) > 0) handleDayChange(dayStr); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); histRef.current?.focus(); } }} style={{ ...PANEL_FIELD_STYLE, textAlign: "center", fontSize: entryFontSize, fontWeight: 500 }} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Histórico</span><SmartHistoricoInput value={historico} onChange={setHistorico} onFillFromHistory={(hist, histLines) => { if (hist) setHistorico(hist); if (histLines?.length) { const d = histLines.find((l) => l.tipo === "D"); const c = histLines.find((l) => l.tipo === "C"); if (d?.conta) setContaD(d.conta); if (c?.conta) setContaC(c.conta); if (d?.valor) setValor(String(d.valor)); } }} onSearchHistoricos={onSearchHistoricos} accounts={accounts} inputRef={histRef} inputStyle={{ fontSize: entryFontSize, fontWeight: 500 }} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Débito</span><AccountCodeInput id="new-conta-d" value={contaD} onChange={setContaD} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); cRef.current?.focus(); } }} accounts={accounts} onGetHistoricosByCode={onGetHistoricosByCode} onSelectHistorico={(text, cD, cC) => { if (text) setHistorico(text); if (cD) setContaD(cD); if (cC) setContaC(cC); }} placeholder="D" inputRef={dRef} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Crédito</span><AccountCodeInput id="new-conta-c" value={contaC} onChange={setContaC} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); valRef.current?.focus(); } }} accounts={accounts} onGetHistoricosByCode={onGetHistoricosByCode} onSelectHistorico={(text, cD, cC) => { if (text) setHistorico(text); if (cD) setContaD(cD); if (cC) setContaC(cC); }} placeholder="C" inputRef={cRef} /></label>
            <label style={PANEL_LABEL_STYLE}><span>Valor</span><input ref={valRef} className="accounting-entry-value-input" type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} placeholder="R$ 0,00" style={{ ...PANEL_FIELD_STYLE, textAlign: "right", fontSize: "1.0625rem", fontWeight: 500, minWidth: 140 }} /></label>
          </div>
          <button type="button" onClick={handleSave} disabled={!canSave} title={!dateVal ? "Informe o dia" : !historico ? "Informe o histórico" : !balanced ? "Valor ou contas incompletos" : duplicateAcrossSides ? "Débito e crédito não podem usar a mesma conta" : "Enter"} style={{ minHeight: 41, padding: "10px 18px", border: "none", borderRadius: 8, background: canSave ? "#69FF47" : "#4b5563", color: "#1A1B26", font: "inherit", fontSize: entryFontSize, fontWeight: 600, cursor: canSave ? "pointer" : "not-allowed", alignSelf: "end" }}>{saving ? "..." : "Salvar"}</button>
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
      {duplicateAcrossSides ? (
        <div style={{ marginTop: 8, fontSize: "0.8125rem", color: "#FF4757", fontWeight: 600 }}>
          Débito e crédito não podem usar a mesma conta.
        </div>
      ) : null}
      {hasConta && <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: ACCOUNTING_PANEL.muted }}><span>Tipo detectado:</span><span style={{ fontWeight: 700, color: "#1A1B26", background: detected.tipo === "PROVISAO" ? "#FFB347" : detected.tipo === "RECEITA" ? "#69FF47" : "#BD93F9", border: "none", borderRadius: 999, padding: "4px 10px" }}>{tipoDetectadoLabel}</span></div>}
      {complexMode && <div style={{ marginTop: 8 }}><LineEditor lines={complexLines} onChange={setComplexLines} accounts={accounts} /></div>}
    </div>
  );
}

export function AccountRow({ entry, accounts, onUpdate, onDelete, saving, onCreateBaixa, savingBaixa, onSearchHistoricos, isSelected = false, onToggleSelect = null, onLoadBaixaTemplate = null }) {
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
  const duplicateAcrossSides = hasDuplicateAccountAcrossSides(lines);
  const incompleteRowStyle = isIncompleteSides ? { outline: "2px solid #8BE9FD", outlineOffset: "-2px" } : null;

  function startEdit() {
    setForm({ data: entry.data ? entry.data.slice(0, 10) : "", historico: entry.historico, tipo: entry.tipo, subtipo: entry.subtipo || "", lines: lines.map((l) => ({ tipo: l.tipo, conta: l.conta, valor: String(Number(l.valor).toFixed(2)) })) });
    setEditing(true);
  }

  async function save() {
    if (hasDuplicateAccountAcrossSides(form?.lines)) return;
    await onUpdate(entry.id, form);
    setEditing(false);
    setForm(null);
  }

  if (editing && form) {
    const editingDuplicateAcrossSides = hasDuplicateAccountAcrossSides(form.lines);

    return (
      <tr style={{ background: ACCOUNTING_PANEL.field }}>
        <td style={{ ...TDv, textAlign: "center", padding: "8px 4px" }}>
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#BD93F9" }}
              aria-label="Selecionar lançamento"
            />
          )}
        </td>
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
        <td style={TDv} colSpan={2}>
          <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
            <div style={{ display: "flex", gap: 4 }}>
              <Button size="lg" variant="success" onClick={save} disabled={saving || editingDuplicateAcrossSides}>{saving ? "..." : "Salvar"}</Button>
              <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setForm(null); }}>Cancelar</Button>
            </div>
            {editingDuplicateAcrossSides ? (
              <div style={{ fontSize: "0.8125rem", color: "#FF4757", fontWeight: 600 }}>
                Débito e crédito não podem usar a mesma conta.
              </div>
            ) : null}
          </div>
        </td>
      </tr>
    );
  }

  const rowBg = ACCOUNTING_PANEL.field;
  const rowBgHover = "#202334";
  return (
    <>
      <tr style={{ background: isSelected ? "#2a2b3d" : rowBg, ...incompleteRowStyle, outline: isSelected ? "1px solid #BD93F9" : "none" }} onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = rowBgHover; }} onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = rowBg; }}>
        <td style={{ ...TDv, textAlign: "center", padding: "8px 4px" }}>
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#BD93F9" }}
              aria-label={`Selecionar ${entry.historico || "lançamento"}`}
            />
          )}
        </td>
        <td style={{ ...TDv, fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtDate(entry.data)}</td>
        <td style={{ ...TDv, textAlign: isSimple ? "center" : "left" }} colSpan={isSimple ? 1 : 2}>
          {isSimple ? <><span style={{ display: "block", textAlign: "center", fontWeight: 700, fontSize: "0.9375rem" }}>{dLine?.conta}</span>{dA && <div style={{ fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>{dA.nome}</div>}</> : <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: "0.875rem", color: ACCOUNTING_PANEL.muted }}>{dCount}D / {cCount}C</span><button onClick={() => setExpanded((v) => !v)} style={{ fontSize: "0.75rem", background: ACCOUNTING_PANEL.surface, border: `1px solid ${ACCOUNTING_PANEL.border}`, color: ACCOUNTING_PANEL.text, borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>{expanded ? "▼" : "▶"}</button></div>}
        </td>
        {isSimple && <td style={{ ...TDv, textAlign: "center" }}><span style={{ display: "block", textAlign: "center", fontWeight: 700, fontSize: "0.9375rem" }}>{cLine?.conta}</span>{cA && <div style={{ fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>{cA.nome}</div>}</td>}
        <td style={{ ...TDv, fontSize: "0.9375rem" }} title={entry.historico}>
          <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.historico || "—"}</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
            {isTemplate
              ? <span style={{ fontSize: "0.7rem", color: "#1A1B26", background: "#FFB347", padding: "2px 7px", borderRadius: 999 }}>agendado</span>
              : entry.origem !== "MANUAL" && <span style={{ fontSize: "0.7rem", color: ACCOUNTING_PANEL.text, background: ACCOUNTING_PANEL.surface, padding: "2px 7px", borderRadius: 999 }}>{ORIGEM_LABELS[entry.origem] || entry.origem}</span>}
            {entry.recalculatedAt && (
              <span
                style={{ fontSize: "0.7rem", color: "#1A1B26", background: "#FFB347", padding: "2px 7px", borderRadius: 999, fontWeight: 700 }}
                title={`Guia recalculada em ${fmtDate(entry.recalculatedAt)} — valor original R$ ${fmtMoney(entry.recalculatedFromValor)} → atualizado R$ ${fmtMoney(entry.recalculatedToValor)} (na circular). O valor do lançamento permanece o original.`}
              >
                Recalculada
              </span>
            )}
          </div>
        </td>
        <td style={{ ...TDv, textAlign: "right", fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{isTemplate ? <span style={{ color: ACCOUNTING_PANEL.muted, fontSize: "0.875rem" }}>—</span> : fmtMoney(totalD)}</td>
        <td style={{ ...TDv, fontSize: "0.875rem", color: ACCOUNTING_PANEL.text }}>{TIPO_LABELS[entry.tipo] || entry.tipo}</td>
        <td style={TDv}>
          {isTemplate ? (
            <TemplateBadge />
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}><StatusChip status={entry.status} /></div>
          )}
        </td>
        <td style={{ ...TDv, textAlign: "right", borderRight: "none" }}><div style={{ display: "flex", gap: 3, justifyContent: "flex-end", flexWrap: "wrap" }}>{!exported && <><button type="button" onClick={startEdit} disabled={saving} style={{ ...PANEL_ICON_BUTTON_STYLE, background: "#BD93F9" }}>✎</button><button type="button" onClick={() => onDelete(entry.id)} disabled={saving} style={{ ...PANEL_ICON_BUTTON_STYLE, background: "#FF4757" }}>⌫</button></>}</div></td>
      </tr>
      {expanded && !isSimple && <tr style={{ background: ACCOUNTING_PANEL.surface }}><td colSpan={9} style={{ padding: "6px 16px", borderBottom: `1px solid ${ACCOUNTING_PANEL.border}` }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}><thead><tr><th style={{ textAlign: "left", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>D/C</th><th style={{ textAlign: "left", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>Conta</th><th style={{ textAlign: "left", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>Nome</th><th style={{ textAlign: "right", padding: "2px 6px", color: ACCOUNTING_PANEL.muted, fontWeight: 700 }}>Valor</th></tr></thead><tbody>{lines.map((l, i) => { const acc = accounts.find((a) => a.codigo === l.conta); return <tr key={i}><td style={{ padding: "2px 6px", fontWeight: 700, color: l.tipo === "D" ? "#8BE9FD" : "#69FF47" }}>{l.tipo}</td><td style={{ padding: "2px 6px", fontWeight: 700 }}>{l.conta}</td><td style={{ padding: "2px 6px", color: ACCOUNTING_PANEL.muted }}>{acc?.nome || "—"}</td><td style={{ padding: "2px 6px", textAlign: "right" }}>{fmtMoney(l.valor)}</td></tr>; })}</tbody></table></td></tr>}
      {showBaixa && <BaixaModal entry={entry} accounts={accounts} saving={savingBaixa} onSave={async (input) => { await onCreateBaixa(entry.id, input); setShowBaixa(false); }} onClose={() => setShowBaixa(false)} onLoadBaixaTemplate={onLoadBaixaTemplate} />}
    </>
  );
}

// =============================================================================
// PayrollEntryModal — botão "Folha / Pró-labore" cria lançamento com contas
// pré-preenchidas a partir do template, exibindo o INSS da guia no rodapé.
// =============================================================================

function competenciaToHistoricoLabel(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : String(competencia || "");
}

function lastDayOfCompetencia(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return "";
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const day = new Date(yyyy, mm, 0).getDate();
  return `${m[1]}-${m[2]}-${String(day).padStart(2, "0")}`;
}

export function PayrollEntryModal({ accounts, defaultCompetencia, onLoadTemplate, onSave, saving, onClose }) {
  const [kind, setKind] = useState("PROLABORE");
  const [competencia, setCompetencia] = useState(defaultCompetencia || "");
  const [template, setTemplate] = useState(null);
  // Cada linha: { data, debito, credito, historico, valor }
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let canceled = false;
    if (!kind || !competencia) return undefined;
    setLoading(true);
    setError(null);
    onLoadTemplate(kind, competencia)
      .then((res) => {
        if (canceled) return;
        const tpl = res?.template || null;
        setTemplate(tpl);
        if (!tpl) return;
        const defaultDate = lastDayOfCompetencia(competencia);
        // Linhas da provisão: cada uma com apenas D OU C preenchido
        const provisaoRows = tpl.lines.map((l) => ({
          data: defaultDate,
          debito: l.side === "D" ? (l.accountCode || "") : "",
          credito: l.side === "C" ? (l.accountCode || "") : "",
          historico: l.historico || "",
          valor: "",
        }));
        // Linha de baixa: D + C preenchidos
        const baixaRow = tpl.baixa
          ? {
              data: defaultDate,
              debito: tpl.baixa.debitAccountCode || "",
              credito: tpl.baixa.creditAccountCode || "",
              historico: tpl.baixa.historico || "",
              valor: "",
            }
          : null;
        setRows(baixaRow ? [...provisaoRows, baixaRow] : provisaoRows);
      })
      .catch((err) => {
        if (canceled) return;
        setError(err?.message || "Falha ao carregar template.");
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => { canceled = true; };
  }, [kind, competencia, onLoadTemplate]);

  function updateRow(idx, field, value) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        data: lastDayOfCompetencia(competencia),
        debito: "",
        credito: "",
        historico: "",
        valor: "",
      },
    ]);
  }

  function removeRow(idx) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  // Linhas válidas: ao menos uma conta + valor > 0
  const validRows = rows.filter(
    (r) => Number(r.valor) > 0 && (String(r.debito || "").trim() || String(r.credito || "").trim())
  );

  // Provisão = linhas com APENAS um lado (D xor C)
  const provisaoRowsFilled = validRows.filter(
    (r) => Boolean(String(r.debito || "").trim()) !== Boolean(String(r.credito || "").trim())
  );
  // Baixas = linhas com AMBOS lados
  const baixaRowsFilled = validRows.filter(
    (r) => String(r.debito || "").trim() && String(r.credito || "").trim()
  );

  const totalD = provisaoRowsFilled
    .filter((r) => r.debito)
    .reduce((s, r) => s + Number(r.valor || 0), 0);
  const totalC = provisaoRowsFilled
    .filter((r) => r.credito)
    .reduce((s, r) => s + Number(r.valor || 0), 0);
  const provisaoBalanced =
    provisaoRowsFilled.length === 0 || (Math.abs(totalD - totalC) < 0.01 && totalD > 0);

  async function handleSave() {
    setError(null);
    if (validRows.length === 0) {
      setError("Preencha valor e contas em ao menos uma linha.");
      return;
    }
    if (!provisaoBalanced) {
      setError(`Provisão desbalanceada — débito R$ ${totalD.toFixed(2)} ≠ crédito R$ ${totalC.toFixed(2)}.`);
      return;
    }

    let provisaoEntry = null;
    if (provisaoRowsFilled.length > 0) {
      const firstDate =
        provisaoRowsFilled.find((r) => r.data)?.data || lastDayOfCompetencia(competencia);
      provisaoEntry = {
        data: firstDate,
        competencia,
        historico: `${kind === "PROLABORE" ? "PRÓ-LABORE" : "FOLHA"} — ${competenciaToHistoricoLabel(competencia)}`,
        tipo: "FOLHA",
        subtipo: kind,
        lines: provisaoRowsFilled.map((r, idx) => ({
          tipo: r.debito ? "D" : "C",
          conta: String(r.debito || r.credito).trim(),
          valor: Number(r.valor),
          historico: r.historico ? String(r.historico).trim() : null,
          ordem: idx,
        })),
      };
    }

    const baixas = baixaRowsFilled.map((r) => ({
      data: r.data || lastDayOfCompetencia(competencia),
      historico: (r.historico || "").trim() || `PAGAMENTO ${competenciaToHistoricoLabel(competencia)}`,
      lines: [
        { tipo: "D", conta: String(r.debito).trim(), valor: Number(r.valor), ordem: 0 },
        { tipo: "C", conta: String(r.credito).trim(), valor: Number(r.valor), ordem: 1 },
      ],
    }));

    await onSave({ entry: provisaoEntry, baixas });
  }

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
  };
  const modal = {
    background: "#24253A", border: "1px solid #44475A", borderRadius: 10,
    padding: 22, width: 980, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto",
    color: "#F8F8F2", boxSizing: "border-box",
  };
  const labelStyle = { display: "grid", gap: 4, fontSize: "0.8125rem", color: "#aeb6d3", marginBottom: 10 };
  const inputStyle = {
    background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6,
    color: "#F8F8F2", padding: "6px 8px", fontSize: "0.85rem", width: "100%", boxSizing: "border-box",
  };
  const cellStyle = { padding: "4px", verticalAlign: "middle", borderBottom: "1px solid #2D2F45" };
  const headStyle = {
    padding: "8px 6px", textAlign: "left", color: "#aeb6d3", fontSize: "0.75rem",
    fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
    borderBottom: "1px solid #44475A", background: "#1A1B26",
  };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Nova Folha / Pró-labore</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6272A4", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <label style={labelStyle}>
            Tipo
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inputStyle, padding: "8px 10px", fontSize: "0.9rem" }}>
              <option value="PROLABORE">Pró-labore</option>
              <option value="FOLHA">Folha de Pagamento</option>
            </select>
          </label>
          <label style={labelStyle}>
            Competência (AAAA-MM)
            <input
              type="text"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value.trim())}
              placeholder="2026-01"
              style={{ ...inputStyle, padding: "8px 10px", fontSize: "0.9rem" }}
            />
          </label>
        </div>

        <p style={{ fontSize: "0.78rem", color: "#aeb6d3", margin: "0 0 8px" }}>
          Preencha apenas <strong>data</strong> e <strong>valor</strong> nas linhas que quiser lançar. Linhas em branco são ignoradas.
        </p>

        {loading && <p style={{ color: "#6272A4" }}>Carregando template...</p>}

        {!loading && rows.length > 0 && (
          <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #44475A" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ ...headStyle, width: "150px" }}>Data</th>
                  <th style={{ ...headStyle, width: "100px" }}>Débito</th>
                  <th style={{ ...headStyle, width: "100px" }}>Crédito</th>
                  <th style={headStyle}>Histórico</th>
                  <th style={{ ...headStyle, width: "150px", textAlign: "right" }}>Valor (R$)</th>
                  <th style={{ ...headStyle, width: "36px" }} aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const dAccount = r.debito && accounts.find((a) => a.codigo === String(r.debito).trim());
                  const cAccount = r.credito && accounts.find((a) => a.codigo === String(r.credito).trim());
                  return (
                    <tr key={idx}>
                      <td style={cellStyle}>
                        <input
                          type="date"
                          value={r.data}
                          onChange={(e) => updateRow(idx, "data", e.target.value)}
                          style={{ ...inputStyle, colorScheme: "dark" }}
                        />
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="text"
                          list={`payroll-acc-${idx}`}
                          value={r.debito}
                          onChange={(e) => updateRow(idx, "debito", e.target.value)}
                          placeholder="—"
                          style={{ ...inputStyle, fontWeight: 700, color: r.debito ? "#8BE9FD" : "#6272A4", textAlign: "center" }}
                        />
                        {dAccount && <div style={{ fontSize: "0.65rem", color: "#6272A4", marginTop: 2, textAlign: "center" }}>{dAccount.nome}</div>}
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="text"
                          list={`payroll-acc-${idx}`}
                          value={r.credito}
                          onChange={(e) => updateRow(idx, "credito", e.target.value)}
                          placeholder="—"
                          style={{ ...inputStyle, fontWeight: 700, color: r.credito ? "#69FF47" : "#6272A4", textAlign: "center" }}
                        />
                        {cAccount && <div style={{ fontSize: "0.65rem", color: "#6272A4", marginTop: 2, textAlign: "center" }}>{cAccount.nome}</div>}
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="text"
                          value={r.historico}
                          onChange={(e) => updateRow(idx, "historico", e.target.value)}
                          style={{ ...inputStyle }}
                        />
                        <datalist id={`payroll-acc-${idx}`}>
                          {accounts.map((a) => (
                            <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>
                          ))}
                        </datalist>
                      </td>
                      <td style={cellStyle}>
                        <input
                          type="number"
                          step="0.01"
                          value={r.valor}
                          onChange={(e) => updateRow(idx, "valor", e.target.value)}
                          placeholder="0,00"
                          style={{ ...inputStyle, textAlign: "right" }}
                        />
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          title="Remover linha"
                          style={{
                            background: "transparent",
                            border: "1px solid #44475A",
                            color: "#FF5757",
                            width: 26, height: 26, borderRadius: 6,
                            cursor: "pointer", fontSize: "0.85rem", lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={6} style={{ padding: "8px 12px", textAlign: "left" }}>
                    <button
                      type="button"
                      onClick={addRow}
                      style={{
                        background: "transparent",
                        border: "1px dashed #6272A4",
                        color: "#BD93F9",
                        padding: "6px 14px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                    >
                      + Adicionar linha
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr style={{ background: "#1A1B26" }}>
                  <td colSpan={6} style={{ padding: "8px 12px", fontSize: "0.78rem", color: provisaoBalanced ? "#69FF47" : "#FFB347" }}>
                    Provisão — D R$ {totalD.toFixed(2)} / C R$ {totalC.toFixed(2)}{" "}
                    {provisaoBalanced ? "✓" : "(desbalanceado)"}
                    {baixaRowsFilled.length > 0 && (
                      <span style={{ marginLeft: 12, color: "#8BE9FD" }}>
                        {baixaRowsFilled.length} pagamento{baixaRowsFilled.length !== 1 ? "s" : ""} a registrar
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {template?.inssGuide && (
          <div style={{ marginTop: 10, padding: 8, fontSize: "0.78rem", color: "#aeb6d3" }}>
            <strong style={{ color: "#FFB347" }}>INSS da guia: R$ {fmtMoney(template.inssGuide.valor)}</strong>
            {template.inssGuide.vencimento && <span> · vencimento {fmtDate(template.inssGuide.vencimento)}</span>}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: 8, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", borderRadius: 6, color: "#FF5757", fontSize: "0.8125rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || loading || validRows.length === 0}>
            {saving ? "Salvando..." : "Salvar lançamento"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// CsvExportModal — escolhe intervalo de competências (AAAA-MM até AAAA-MM)
// =============================================================================

export function CsvExportModal({ defaultCompetencia, onExport, onClose }) {
  const [inicio, setInicio] = useState(defaultCompetencia || "");
  const [fim, setFim] = useState(defaultCompetencia || "");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const validFormat = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ""));

  async function handleExport() {
    setError("");
    if (!validFormat(inicio) || !validFormat(fim)) {
      setError("Use o formato AAAA-MM (ex: 2026-01).");
      return;
    }
    if (fim < inicio) {
      setError("A competência final deve ser maior ou igual à inicial.");
      return;
    }
    setExporting(true);
    try {
      await onExport({ competenciaInicio: inicio, competenciaFim: fim });
      onClose();
    } catch (err) {
      setError(err?.message || "Falha ao exportar.");
    } finally {
      setExporting(false);
    }
  }

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
  };
  const modal = {
    background: "#24253A", border: "1px solid #44475A", borderRadius: 10,
    padding: 22, width: 460, maxWidth: "100%", color: "#F8F8F2", boxSizing: "border-box",
  };
  const labelStyle = { display: "grid", gap: 4, fontSize: "0.8125rem", color: "#aeb6d3", marginBottom: 12 };
  const inputStyle = {
    background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6,
    color: "#F8F8F2", padding: "8px 10px", fontSize: "0.95rem", width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Exportar CSV</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6272A4", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <p style={{ fontSize: "0.85rem", color: "#aeb6d3", margin: "0 0 14px" }}>
          Selecione o intervalo de competências a exportar. O arquivo terá 5 colunas:
          Data, Código Débito, Código Crédito, Histórico, Valor.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={labelStyle}>
            Competência inicial
            <input
              type="month"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              style={{ ...inputStyle, colorScheme: "dark" }}
            />
          </label>
          <label style={labelStyle}>
            Competência final
            <input
              type="month"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              style={{ ...inputStyle, colorScheme: "dark" }}
            />
          </label>
        </div>

        {error && (
          <div style={{ padding: 8, marginTop: 4, marginBottom: 8, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", borderRadius: 6, color: "#FF5757", fontSize: "0.8125rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <Button variant="secondary" onClick={onClose} disabled={exporting}>Cancelar</Button>
          <Button variant="primary" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exportando..." : "Exportar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
