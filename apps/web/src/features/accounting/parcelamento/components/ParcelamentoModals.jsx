// Q9: 4 modais coexistindo neste arquivo (escopo acoplado, padrão usado em Q6):
//   - ParcelamentoCreateModal: wizard pra criar parcelamento novo (templates + dados + preview)
//   - ParcelamentosList: tabela embedável na Circular (cabeçalhos expansíveis + parcelas)
//   - ParcelaPaymentModal: confirmar pagamento (só "juros do mês")
//   - GuideLinkParcelamentoModal: "esta guia é parcela? vincular existente ou criar novo"

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { AccountCodeInput } from "../../entries/components/renderAccountingEntriesParts";

// Fechamento dos modais deste arquivo: ESC fecha, clicar fora NÃO.
// Clique no backdrop fechava e fazia perder o preenchimento inteiro sem confirmação —
// esses modais são formulários longos (linhas de provisão/pagamento). Saída = ✕, Cancelar ou ESC.
function useEscapeToClose(onClose) {
  useEffect(() => {
    if (!onClose) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

const PANEL = {
  surface: "#21222C", field: "#282A36", border: "#44475A",
  text: "#F8F8F2", muted: "#aeb6d3",
};
const FIELD_STYLE = {
  background: PANEL.field,
  border: `1px solid ${PANEL.border}`,
  color: PANEL.text,
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: "0.85rem",
  width: "100%",
};

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function addMonths(competencia, n) {
  const [yyyy, mm] = String(competencia || "").split("-").map(Number);
  if (!yyyy || !mm) return competencia;
  const date = new Date(Date.UTC(yyyy, mm - 1 + n, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const TIPOS_PARC = [
  ["PARCSN", "Simples Nacional (PARCSN)"],
  ["PARCSN_ESPECIAL", "Simples Nacional Especial"],
  ["PERT_SN", "PERT-SN"],
  ["RELP_SN", "RELP-SN"],
  ["PARCMEI", "MEI (PARCMEI)"],
  ["PARCMEI_ESPECIAL", "MEI Especial"],
  ["PERT_MEI", "PERT-MEI"],
  ["RELP_MEI", "RELP-MEI"],
  ["INSS", "INSS / Previdenciário"],
  ["OUTRO", "Outro"],
];

// ─────────────────────────────────────────────────────────────────────────
// Q23: ParcelamentoIngestaoModal — sobe a guia MANUAL da 1ª parcela.
// Cria/anexa o parcelamento + a PROVISÃO (dívida consolidada, ≥3 linhas editáveis). NÃO gera
// pagamento — a baixa sai depois, ao marcar a guia como paga na aba Guias. As contas D/C começam
// em branco (ou pré-preenchidas da memória) e são memorizadas após o 1º preenchimento.
// A composição por tributo é guardada pra montar o pagamento futuro (juros LIDO).
// ─────────────────────────────────────────────────────────────────────────
// Provisão da dívida (espelha o lançamento real; editável): D principal + D juros / C parcelamento a
// pagar (passivo, = total). Crédito = soma dos débitos. NÃO credita caixa.
const PROV_LINHAS_PADRAO = [
  { tipoLinha: "PRINCIPAL", label: "Principal", tipo: "D", conta: "", valor: "" },
  { tipoLinha: "JUROS", label: "Juros", tipo: "D", conta: "", valor: "" },
  { tipoLinha: "PARC", label: "Parcelamento a pagar (total)", tipo: "C", conta: "", valor: "" },
];

// Q28 Fase 1: config de COMO o pagamento de cada parcela será lançado (papel/lado/conta — sem valor;
// o valor sai da composição quando a guia é paga, pelo SERPRO ou pelo usuário). D parcelamento a pagar
// (amortiza o passivo) + D juros / C caixa. As contas começam em branco e aprendem.
const PAG_LINHAS_PADRAO = [
  { tipoLinha: "PARC", label: "Parcelamento a pagar (baixa do principal)", tipo: "D", conta: "" },
  { tipoLinha: "JUROS", label: "Juros", tipo: "D", conta: "" },
  { tipoLinha: "CAIXA", label: "Caixa / Banco", tipo: "C", conta: "" },
];

export function ParcelamentoIngestaoModal({ guide, prefill, existingParc = null, saving, onIngest, onSkip, onClose, getContasProvisao, accounts = [], onSearchHistoricos, onGetHistoricosByCode }) {
  useEscapeToClose(onClose);
  // Modo "anexar a parcelamento existente": a dívida já foi provisionada na 1ª parcela; aqui só
  // vinculamos a guia como a PRÓXIMA parcela (modalidade/nº travados) e contabilizamos a baixa.
  const isExisting = Boolean(existingParc);
  const compInicial = Array.isArray(guide?.extracted?.composicao) ? guide.extracted.composicao : [];
  // Q28: prefill vem do SERPRO (consulta por código) — pré-preenche o cabeçalho. Sem guia nesse caso.
  const [tipo, setTipo] = useState(existingParc?.tipo || prefill?.tipo || "PARCSN");
  const [numeroParcelamento, setNumeroParcelamento] = useState(
    existingParc?.numeroParcelamento ? String(existingParc.numeroParcelamento)
      : prefill?.numeroParcelamento ? String(prefill.numeroParcelamento) : "");
  // Sugere a próxima parcela: maior nº de parcela já vinculada + 1 (senão, parcelaInicial / 1).
  const proximaParcela = (() => {
    if (!existingParc) return prefill?.parcelaInicial ? String(prefill.parcelaInicial) : "1";
    const nums = (existingParc.guides || []).map((g) => Number(g.numeroParcela) || 0);
    const base = nums.length ? Math.max(...nums) : (Number(existingParc.parcelaInicial || 1) - 1);
    return String(base + 1);
  })();
  const [numeroParcela, setNumeroParcela] = useState(proximaParcela);
  const [quantidadeParcelas, setQuantidadeParcelas] = useState(
    existingParc?.numParcelas ? String(existingParc.numParcelas)
      : prefill?.quantidadeParcelas ? String(prefill.quantidadeParcelas) : "");
  const [dataAdesao, setDataAdesao] = useState("");
  // Q31: descrição (quais competências foram parceladas) — preenchida ao provisionar.
  const [descricao, setDescricao] = useState("");
  // Q23: linhas da provisão (dívida consolidada do parcelamento inteiro).
  const [provLines, setProvLines] = useState(() => PROV_LINHAS_PADRAO.map((l) => ({ ...l })));
  // Q28: config de como o PAGAMENTO de cada parcela será lançado (papel/lado/conta).
  const [pagLines, setPagLines] = useState(() => PAG_LINHAS_PADRAO.map((l) => ({ ...l })));
  const [tributos, setTributos] = useState(() => {
    if (compInicial.length) {
      return compInicial.map((c) => ({
        codigoTributo: String(c.codigoTributo || c.codigo || ""),
        principal: c.principal != null ? String(c.principal) : "",
        multa: c.multa != null ? String(c.multa) : "",
        juros: c.juros != null ? String(c.juros) : "",
        total: c.total != null ? String(c.total) : "",
      }));
    }
    // Sem composição extraída do PDF: pré-preenche 1 linha com o valor da própria guia (principal),
    // juros 0 — o contador ajusta. Código "DAS" como default (parcela única do Simples).
    const v = guide?.valor != null ? String(guide.valor) : "";
    return [{ codigoTributo: "DAS", principal: v, multa: "", juros: "", total: v }];
  });
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const num = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };

  // Q23: pré-preenche as contas da provisão a partir da memória (MapaContaTributo) por modalidade.
  // Só depende de `tipo` (getContasProvisao é recriada a cada render → fora das deps evita loop).
  useEffect(() => {
    let cancel = false;
    if (!getContasProvisao) return undefined;
    (async () => {
      const contas = await getContasProvisao(tipo);
      if (cancel || !contas) return;
      setProvLines((prev) => {
        let changed = false;
        const next = prev.map((l) => {
          if (!l.conta && contas[l.tipoLinha]) { changed = true; return { ...l, conta: contas[l.tipoLinha] }; }
          return l;
        });
        return changed ? next : prev; // evita re-render desnecessário
      });
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  function setProv(i, k, v) { setProvLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l))); }
  function addProv() { setProvLines((p) => [...p, { tipoLinha: "PRINCIPAL", label: "", tipo: "D", conta: "", valor: "" }]); }
  function rmProv(i) { setProvLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p)); }

  function setPag(i, k, v) { setPagLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l))); }
  function addPag() { setPagLines((p) => [...p, { tipoLinha: "PARC", label: "", tipo: "D", conta: "" }]); }
  function rmPag(i) { setPagLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p)); }

  function setTrib(i, k, v) { setTributos((p) => p.map((t, idx) => (idx === i ? { ...t, [k]: v } : t))); }
  function addTrib() { setTributos((p) => [...p, { codigoTributo: "", principal: "", multa: "", juros: "", total: "" }]); }
  function rmTrib(i) { setTributos((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p)); }

  const somaD = useMemo(() => provLines.filter((l) => l.tipo === "D").reduce((s, l) => s + num(l.valor), 0), [provLines]);
  const somaC = useMemo(() => provLines.filter((l) => l.tipo === "C").reduce((s, l) => s + num(l.valor), 0), [provLines]);
  const somaComposicao = useMemo(
    () => tributos.reduce((s, t) => s + (t.total !== "" ? num(t.total) : num(t.principal) + num(t.multa) + num(t.juros)), 0),
    [tributos],
  );

  async function submit() {
    setErro("");
    if (!String(numeroParcelamento).trim()) { setErro("Informe o nº do parcelamento (obrigatório para a busca automática)."); return; }
    if (!numeroParcela) { setErro("Informe o número desta parcela."); return; }
    // Anexo a parcelamento existente: a provisão já existe — não reenviamos linhas (o backend mantém
    // a config e não duplica a provisão, pois aberturaEntryId já está setado).
    const provClean = isExisting ? [] : provLines
      .filter((l) => l.valor !== "" || String(l.conta).trim())
      .map((l) => ({ tipoLinha: l.tipoLinha || (l.tipo === "C" ? "PARC" : "PRINCIPAL"), tipo: l.tipo, conta: String(l.conta).trim(), valor: num(l.valor) }));
    if (!isExisting && !provClean.length) { setErro("Preencha ao menos uma linha da provisão."); return; }

    // Composição da parcela (usada na baixa futura) — OPCIONAL. Normaliza pra fechar p+m+j==total:
    // se só o total veio, joga no principal; senão recalcula o total a partir do detalhamento.
    const tribClean = tributos
      .filter((t) => String(t.codigoTributo).trim() && (t.principal !== "" || t.multa !== "" || t.juros !== "" || t.total !== ""))
      .map((t) => {
        let principal = num(t.principal); const multa = num(t.multa); const juros = num(t.juros);
        let total = t.total !== "" ? num(t.total) : principal + multa + juros;
        if (principal + multa + juros === 0 && total > 0) principal = total;
        total = Math.round((principal + multa + juros) * 100) / 100;
        return { codigoTributo: String(t.codigoTributo).trim(), principal, multa, juros, total };
      });

    // Cabeçalho consolidado derivado das linhas da provisão (alimenta o registro do parcelamento).
    // Provisão = D principal + D juros [+ multa] / C parcelamento a pagar (total = soma dos débitos).
    const sumBy = (tl) => provLines.filter((l) => l.tipoLinha === tl && l.tipo === "D").reduce((s, l) => s + num(l.valor), 0);
    // Anexo: não reenvia config de pagamento (o parcelamento já tem a sua) → backend mantém.
    const pagClean = isExisting ? [] : pagLines
      .filter((l) => l.tipoLinha || String(l.conta).trim())
      .map((l) => ({ tipoLinha: l.tipoLinha || (l.tipo === "C" ? "CAIXA" : "PARC"), tipo: l.tipo, conta: String(l.conta).trim() }));

    const body = {
      guideId: guide?.guideId || guide?.id || null, // Q28: SERPRO = sem guia
      header: {
        tipo,
        numeroParcelamento: numeroParcelamento.trim(),
        numeroParcela: Number(numeroParcela),
        quantidadeParcelas: quantidadeParcelas ? Number(quantidadeParcelas) : null,
        valorPrincipal: sumBy("PRINCIPAL") || null,
        valorMulta: sumBy("MULTA") || null,
        valorJuros: sumBy("JUROS") || null,
        valorTotal: somaC || null,
        dataAdesao: dataAdesao || null,
        anoMesParcela: guide?.competencia || null,
        vencimento: guide?.vencimento || null,
        descricao: descricao.trim() || null,
      },
      provisaoLines: provClean,
      pagamentoLines: pagClean,
      tributos: tribClean,
    };
    setBusy(true);
    try {
      await onIngest(body);
    } catch (err) {
      setErro(err?.message || "Falha ao registrar a provisão.");
    } finally {
      setBusy(false);
    }
  }

  const lbl = { fontSize: "0.72rem", color: PANEL.muted, display: "block", marginBottom: 2 };
  const iconBtn = { background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.text, borderRadius: 6, width: 26, height: 26, lineHeight: "22px", textAlign: "center", cursor: "pointer", fontSize: "1rem", padding: 0 };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 20, width: "min(96vw, 1040px)", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", overflowWrap: "anywhere", color: PANEL.text, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "1.05rem" }}>{isExisting ? "Anexar parcela ao parcelamento" : "Registrar 1ª parcela do parcelamento"}</strong>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>
        {isExisting ? (
          <div style={{ fontSize: "0.8rem", color: PANEL.muted }}>
            Vincula esta guia como a <strong>próxima parcela</strong> de
            {" "}<strong style={{ color: PANEL.text }}>{existingParc?.label || `${existingParc?.tipo || ""} nº ${existingParc?.numeroParcelamento || ""}`}</strong>.
            A provisão já existe — ao confirmar, a parcela é <strong>contabilizada</strong> (baixa com histórico
            “PARC {numeroParcela}/{quantidadeParcelas || existingParc?.numParcelas || "?"}”).
          </div>
        ) : (
          <div style={{ fontSize: "0.8rem", color: PANEL.muted }}>
            Cria <strong>apenas a provisão</strong> (dívida consolidada do parcelamento) e ativa a busca automática
            do SERPRO. O <strong>pagamento</strong> de cada parcela é lançado depois, ao marcar a guia como
            <strong> paga</strong> na aba Guias.
          </div>
        )}

        {/* Cabeçalho do parcelamento */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <label><span style={lbl}>Modalidade</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={isExisting} style={{ ...FIELD_STYLE, colorScheme: "dark", opacity: isExisting ? 0.6 : 1 }}>
              {TIPOS_PARC.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label><span style={lbl}>Nº do parcelamento *</span>
            <input value={numeroParcelamento} onChange={(e) => setNumeroParcelamento(e.target.value)} readOnly={isExisting} placeholder="oficial (RFB)" style={{ ...FIELD_STYLE, opacity: isExisting ? 0.6 : 1 }} />
          </label>
          <label><span style={lbl}>Data adesão</span>
            <input type="date" value={dataAdesao} onChange={(e) => setDataAdesao(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }} />
          </label>
          <label><span style={lbl}>Nº desta parcela</span>
            <input type="number" value={numeroParcela} onChange={(e) => setNumeroParcela(e.target.value)} style={FIELD_STYLE} />
          </label>
          <label><span style={lbl}>Qtd. de parcelas</span>
            <input type="number" value={quantidadeParcelas} onChange={(e) => setQuantidadeParcelas(e.target.value)} style={FIELD_STYLE} />
          </label>
          <div />
        </div>

        {/* Q31: descrição das competências parceladas (preenchida ao provisionar). */}
        <label><span style={lbl}>Descrição (competências parceladas)</span>
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2}
            placeholder="Ex.: DAS de SET/OUT/NOV/2024 e MAR..NOV/2025"
            style={{ ...FIELD_STYLE, resize: "vertical" }} />
        </label>

        {/* Provisão — linhas do lançamento (dívida consolidada do parcelamento inteiro). Só na 1ª parcela. */}
        {!isExisting && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
          <div style={{ fontSize: "0.78rem", color: PANEL.muted }}>Provisão</div>
          <button onClick={addProv} title="Adicionar linha" style={iconBtn}>+</button>
        </div>
        )}
        {!isExisting && (<>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead><tr style={{ color: PANEL.muted }}>
            <th style={{ textAlign: "left", padding: 3 }}>Descrição</th>
            <th style={{ padding: 3, width: 56 }}>D/C</th>
            <th style={{ padding: 3, width: 110 }}>Conta</th>
            <th style={{ padding: 3, width: 120, textAlign: "right" }}>Valor</th>
            <th style={{ width: 28 }} />
          </tr></thead>
          <tbody>
            {provLines.map((l, i) => (
              <tr key={i}>
                <td style={{ padding: 3 }}><input value={l.label} onChange={(e) => setProv(i, "label", e.target.value)} placeholder="descrição" style={{ ...FIELD_STYLE, padding: "4px 6px" }} /></td>
                <td style={{ padding: 3 }}>
                  <select value={l.tipo} onChange={(e) => setProv(i, "tipo", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                    <option value="D">D</option><option value="C">C</option>
                  </select>
                </td>
                <td style={{ padding: 3 }}>
                  <AccountCodeInput
                    value={l.conta}
                    onChange={(v) => setProv(i, "conta", v)}
                    accounts={accounts}
                    onSearchHistoricos={onSearchHistoricos}
                    onGetHistoricosByCode={onGetHistoricosByCode}
                    placeholder="—"
                  />
                </td>
                <td style={{ padding: 3 }}><input value={l.valor} onChange={(e) => setProv(i, "valor", e.target.value)} placeholder="0,00" style={{ ...FIELD_STYLE, padding: "4px 6px", textAlign: "right" }} /></td>
                <td style={{ padding: 3, textAlign: "center" }}><button onClick={() => rmProv(i)} style={{ background: "transparent", border: "none", color: "#FF5757", cursor: "pointer" }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: "right", fontSize: "0.78rem", color: somaD === somaC ? PANEL.muted : "#FFB347" }}>
          Σ Débito: <strong style={{ color: PANEL.text }}>{fmtMoney(somaD)}</strong> · Σ Crédito: <strong style={{ color: PANEL.text }}>{fmtMoney(somaC)}</strong>
          {somaD !== somaC ? "  ⚠ D ≠ C" : ""}
        </div>
        </>)}

        {/* Composição por tributo desta parcela (usada no pagamento futuro) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
          <div style={{ fontSize: "0.78rem", color: PANEL.muted }}>Composição por tributo</div>
          <button onClick={addTrib} title="Adicionar tributo" style={iconBtn}>+</button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead><tr style={{ color: PANEL.muted, textAlign: "right" }}>
            <th style={{ textAlign: "left", padding: 3 }}>Código</th>
            <th style={{ padding: 3 }}>Principal</th><th style={{ padding: 3 }}>Multa</th>
            <th style={{ padding: 3 }}>Juros</th><th style={{ padding: 3 }}>Total</th><th style={{ width: 28 }} />
          </tr></thead>
          <tbody>
            {tributos.map((t, i) => (
              <tr key={i}>
                <td style={{ padding: 3 }}><input value={t.codigoTributo} onChange={(e) => setTrib(i, "codigoTributo", e.target.value)} placeholder="1001" style={{ ...FIELD_STYLE, padding: "4px 6px" }} /></td>
                {["principal", "multa", "juros", "total"].map((k) => (
                  <td key={k} style={{ padding: 3 }}><input value={t[k]} onChange={(e) => setTrib(i, k, e.target.value)} placeholder="0,00" style={{ ...FIELD_STYLE, padding: "4px 6px", textAlign: "right" }} /></td>
                ))}
                <td style={{ padding: 3, textAlign: "center" }}><button onClick={() => rmTrib(i)} style={{ background: "transparent", border: "none", color: "#FF5757", cursor: "pointer" }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: "right", fontSize: "0.78rem", color: PANEL.muted }}>Σ composição: <strong style={{ color: PANEL.text }}>{fmtMoney(somaComposicao)}</strong></div>

        {/* Q28: config de COMO o pagamento de cada parcela será lançado (sem valor — sai da composição
            quando a guia for paga, pelo SERPRO ou pelo usuário). Contas aprendem após o 1º uso.
            Só na 1ª parcela — ao anexar a um parcelamento existente, a config dele é reaproveitada. */}
        {!isExisting && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
          <div style={{ fontSize: "0.78rem", color: PANEL.muted }}>Pagamento (baixa)</div>
          <button onClick={addPag} title="Adicionar linha" style={iconBtn}>+</button>
        </div>
        )}
        {!isExisting && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead><tr style={{ color: PANEL.muted }}>
            <th style={{ textAlign: "left", padding: 3 }}>Descrição</th>
            <th style={{ padding: 3, width: 56 }}>D/C</th>
            <th style={{ padding: 3, width: 110 }}>Conta</th>
            <th style={{ width: 28 }} />
          </tr></thead>
          <tbody>
            {pagLines.map((l, i) => (
              <tr key={i}>
                <td style={{ padding: 3 }}><input value={l.label} onChange={(e) => setPag(i, "label", e.target.value)} placeholder="descrição" style={{ ...FIELD_STYLE, padding: "4px 6px" }} /></td>
                <td style={{ padding: 3 }}>
                  <select value={l.tipo} onChange={(e) => setPag(i, "tipo", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                    <option value="D">D</option><option value="C">C</option>
                  </select>
                </td>
                <td style={{ padding: 3 }}>
                  <AccountCodeInput
                    value={l.conta}
                    onChange={(v) => setPag(i, "conta", v)}
                    accounts={accounts}
                    onSearchHistoricos={onSearchHistoricos}
                    onGetHistoricosByCode={onGetHistoricosByCode}
                    placeholder="—"
                  />
                </td>
                <td style={{ padding: 3, textAlign: "center" }}><button onClick={() => rmPag(i)} style={{ background: "transparent", border: "none", color: "#FF5757", cursor: "pointer" }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        )}

        {erro && <div style={{ color: "#FF5757", fontSize: "0.8rem" }}>{erro}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
          {!isExisting && (
            <button onClick={onSkip} disabled={saving || busy} style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.muted, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: "0.85rem" }}>Não é parcela</button>
          )}
          <Button variant="primary" onClick={submit} disabled={saving || busy}>
            {saving || busy ? (isExisting ? "Anexando…" : "Registrando…") : (isExisting ? "Anexar e contabilizar" : "Registrar provisão")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Q28 Fase 1: ParcelamentoEntradaModal — porta de entrada do parcelamento.
// Escolha: consultar o nº no SERPRO (pré-preenche) OU subir uma guia manualmente.
// ─────────────────────────────────────────────────────────────────────────
export function ParcelamentoEntradaModal({ parcelamentosAtivos = [], onChooseAttach, onConsultSerpro, onResolved, onChooseUpload, onClose }) {
  useEscapeToClose(onClose);
  const [tipo, setTipo] = useState("PARCSN");
  const [numero, setNumero] = useState("");
  const [attachId, setAttachId] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const lbl = { fontSize: "0.72rem", color: PANEL.muted, display: "block", marginBottom: 2 };
  const ativos = (parcelamentosAtivos || []).filter((p) => p.status === "ATIVO");

  async function consultar() {
    setErro("");
    if (!String(numero).trim()) { setErro("Informe o nº do parcelamento."); return; }
    setBusy(true);
    try {
      const dto = await onConsultSerpro({ tipo, numeroParcelamento: numero.trim() });
      onResolved({
        tipo,
        numeroParcelamento: numero.trim(),
        quantidadeParcelas: dto?.quantidadeParcelas || null,
        parcelaInicial: 1,
        origem: "SERPRO",
      });
    } catch (err) {
      setErro(err?.message || "Falha ao consultar no SERPRO.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 20, width: "min(96vw, 560px)", color: PANEL.text, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "1.05rem" }}>Novo parcelamento</strong>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>

        {/* Opção: anexar a um parcelamento ATIVO existente (próxima parcela) — sempre visível. */}
        {onChooseAttach && (
          <div style={{ border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <strong style={{ fontSize: "0.85rem" }}>Anexar a um parcelamento existente (próxima parcela)</strong>
            {ativos.length === 0 ? (
              <div style={{ fontSize: "0.75rem", color: PANEL.muted }}>
                Nenhum parcelamento ativo.
              </div>
            ) : (
              <>
                <select value={attachId} onChange={(e) => setAttachId(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }}>
                  <option value="">— selecione o parcelamento —</option>
                  {ativos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label || `${p.tipo} nº ${p.numeroParcelamento || ""}`} · {p.numParcelas || "?"}x · R$ {fmtMoney(p.totalValue)}
                    </option>
                  ))}
                </select>
                <div style={{ textAlign: "right" }}>
                  <Button
                    variant="primary"
                    disabled={busy || !attachId}
                    onClick={() => {
                      const parc = ativos.find((p) => p.id === attachId);
                      if (parc) onChooseAttach(parc);
                    }}
                  >
                    Subir guia desta parcela…
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Opção SERPRO */}
        <div style={{ border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: "0.85rem" }}>Buscar no SERPRO (por código)</strong>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label><span style={lbl}>Modalidade</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }}>
                {TIPOS_PARC.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label><span style={lbl}>Nº do parcelamento</span>
              <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="oficial (RFB)" style={FIELD_STYLE} />
            </label>
          </div>
          <div style={{ textAlign: "right" }}>
            <Button variant="primary" onClick={consultar} disabled={busy}>{busy ? "Consultando…" : "Consultar no SERPRO"}</Button>
          </div>
        </div>

        {/* Opção manual */}
        <div style={{ border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "0.85rem" }}>Subir guia manualmente</strong>
          <Button variant="secondary" onClick={onChooseUpload} disabled={busy}>Subir guia…</Button>
        </div>

        {erro && <div style={{ color: "#FF5757", fontSize: "0.8rem" }}>{erro}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Q28 Fase 2: ParcelamentoConfigModal — ver/editar a config de lançamento (provisão + pagamento)
// de um parcelamento específico (acessível pela Circular/aba Guias).
// ─────────────────────────────────────────────────────────────────────────
const CFG_PROV_PADRAO = [{ tipoLinha: "PRINCIPAL", tipo: "D", conta: "" }, { tipoLinha: "JUROS", tipo: "D", conta: "" }, { tipoLinha: "PARC", tipo: "C", conta: "" }];
const CFG_PAG_PADRAO = [{ tipoLinha: "PARC", tipo: "D", conta: "" }, { tipoLinha: "JUROS", tipo: "D", conta: "" }, { tipoLinha: "CAIXA", tipo: "C", conta: "" }];
const ROLE_LABEL = { PRINCIPAL: "Principal", JUROS: "Juros", MULTA: "Multa", PARC: "Parcelamento a pagar (passivo)", CAIXA: "Caixa / Banco", CONTRAPARTIDA: "Contrapartida (despesa/reclasse)" };
const normCfgRow = (r) => ({ tipoLinha: r?.tipoLinha || "PARC", tipo: r?.tipo === "C" ? "C" : "D", conta: r?.conta || "" });

export function ParcelamentoConfigModal({ parcId, label, getConfig, saveConfig, onClose, onSaved, accounts = [], onSearchHistoricos, onGetHistoricosByCode }) {
  useEscapeToClose(onClose);
  const [prov, setProv] = useState([]);
  const [pag, setPag] = useState([]);
  const [obs, setObs] = useState(""); // Q31: descrição (competências parceladas)
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const p = await getConfig(parcId);
        if (cancel) return;
        setProv(Array.isArray(p?.configProvisao) && p.configProvisao.length ? p.configProvisao.map(normCfgRow) : CFG_PROV_PADRAO.map((r) => ({ ...r })));
        setPag(Array.isArray(p?.configPagamento) && p.configPagamento.length ? p.configPagamento.map(normCfgRow) : CFG_PAG_PADRAO.map((r) => ({ ...r })));
        setObs(p?.observacoes || "");
      } catch (e) { if (!cancel) setErro(e?.message || "Falha ao carregar config."); }
      finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [parcId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ROLES = Object.keys(ROLE_LABEL);
  const setRow = (which, i, k, v) => (which === "prov" ? setProv : setPag)((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addRow = (which) => (which === "prov" ? setProv : setPag)((p) => [...p, { tipoLinha: "PARC", tipo: "D", conta: "" }]);
  const rmRow = (which, i) => (which === "prov" ? setProv : setPag)((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p));

  async function save() {
    setErro(""); setBusy(true);
    try {
      await saveConfig(parcId, { configProvisao: prov, configPagamento: pag, observacoes: obs });
      if (onSaved) onSaved();
      onClose();
    } catch (e) { setErro(e?.message || "Falha ao salvar."); }
    finally { setBusy(false); }
  }

  const lbl = { fontSize: "0.72rem", color: PANEL.muted, display: "block", marginBottom: 4 };
  const tbl = (which, rows) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
      <thead><tr style={{ color: PANEL.muted }}>
        <th style={{ textAlign: "left", padding: 3 }}>Papel</th>
        <th style={{ padding: 3, width: 56 }}>D/C</th>
        <th style={{ padding: 3, width: 120 }}>Conta</th>
        <th style={{ width: 28 }} />
      </tr></thead>
      <tbody>
        {rows.map((l, i) => (
          <tr key={i}>
            <td style={{ padding: 3 }}>
              <select value={l.tipoLinha} onChange={(e) => setRow(which, i, "tipoLinha", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </td>
            <td style={{ padding: 3 }}>
              <select value={l.tipo} onChange={(e) => setRow(which, i, "tipo", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                <option value="D">D</option><option value="C">C</option>
              </select>
            </td>
            <td style={{ padding: 3 }}>
              <AccountCodeInput
                value={l.conta}
                onChange={(v) => setRow(which, i, "conta", v)}
                accounts={accounts}
                onSearchHistoricos={onSearchHistoricos}
                onGetHistoricosByCode={onGetHistoricosByCode}
                placeholder="—"
              />
            </td>
            <td style={{ padding: 3, textAlign: "center" }}><button onClick={() => rmRow(which, i)} style={{ background: "transparent", border: "none", color: "#FF5757", cursor: "pointer" }}>×</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 20, width: "min(96vw, 860px)", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", overflowWrap: "anywhere", color: PANEL.text, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "1.0rem" }}>Configuração de lançamento — {label}</strong>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>
        {loading ? <div style={{ color: PANEL.muted, fontSize: "0.85rem" }}>Carregando…</div> : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={lbl}>Provisão (adesão)</span>
              <button onClick={() => addRow("prov")} style={{ ...FIELD_STYLE, width: 26, height: 26, padding: 0, cursor: "pointer" }}>+</button>
            </div>
            {tbl("prov", prov)}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <span style={lbl}>Pagamento (baixa)</span>
              <button onClick={() => addRow("pag")} style={{ ...FIELD_STYLE, width: 26, height: 26, padding: 0, cursor: "pointer" }}>+</button>
            </div>
            {tbl("pag", pag)}
            <div style={{ marginTop: 6 }}>
              <span style={lbl}>Descrição (competências parceladas)</span>
              <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2}
                placeholder="Ex.: DAS de SET/OUT/NOV/2024 e MAR..NOV/2025"
                style={{ ...FIELD_STYLE, resize: "vertical" }} />
            </div>
            {erro && <div style={{ color: "#FF5757", fontSize: "0.8rem" }}>{erro}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={onClose} disabled={busy} style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.muted, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: "0.85rem" }}>Cancelar</button>
              <Button variant="primary" onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar config"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Q31: ParcelamentoRescisaoModal — 3 linhas pré-configuradas (estorno reverso da provisão),
// editáveis, com saldo remanescente sugerido. Ao confirmar, lança a rescisão (single-leg por linha).
// ─────────────────────────────────────────────────────────────────────────
export function ParcelamentoRescisaoModal({ parc, getConfig, saving, onConfirm, onClose, accounts = [], onSearchHistoricos, onGetHistoricosByCode }) {
  useEscapeToClose(onClose);
  const [lines, setLines] = useState([]);
  const [dataRescisao, setDataRescisao] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  const num = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };

  useEffect(() => {
    let cancel = false;
    (async () => {
      const pagas = Number(parc?.parcelasPagas) || 0;
      const n = Number(parc?.numParcelas) || 0;
      const abertas = Math.max(0, n - pagas);
      const principalRem = Number.isFinite(Number(parc?.saldoRestante)) ? Number(parc.saldoRestante) : 0;
      const jurosTotal = Number(parc?.jurosTotal) || 0;
      const jurosRem = n ? Math.round(jurosTotal * (abertas / n) * 100) / 100 : 0;
      const totalRem = Math.round((principalRem + jurosRem) * 100) / 100;
      const valorPorPapel = { PARC: totalRem, PRINCIPAL: principalRem, JUROS: jurosRem, MULTA: 0 };

      let cfg = null;
      try { const p = await getConfig(parc.id); cfg = Array.isArray(p?.configProvisao) ? p.configProvisao : null; } catch { /* sem config */ }
      if (cancel) return;
      // Estorno reverso: inverte D↔C de cada linha da provisão; mantém a conta; valor = remanescente do papel.
      const base = (cfg && cfg.length)
        ? cfg.map((l) => ({
          tipoLinha: l.tipoLinha,
          label: ROLE_LABEL[l.tipoLinha] || l.tipoLinha,
          tipo: l.tipo === "C" ? "D" : "C",
          conta: l.conta || "",
          valor: valorPorPapel[l.tipoLinha] != null ? String(valorPorPapel[l.tipoLinha]) : "",
        }))
        : [
          { tipoLinha: "PARC", label: ROLE_LABEL.PARC, tipo: "D", conta: "", valor: String(totalRem) },
          { tipoLinha: "PRINCIPAL", label: ROLE_LABEL.PRINCIPAL, tipo: "C", conta: "", valor: String(principalRem) },
          { tipoLinha: "JUROS", label: ROLE_LABEL.JUROS, tipo: "C", conta: "", valor: String(jurosRem) },
        ];
      setLines(base);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [parc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ROLES = Object.keys(ROLE_LABEL);
  function setLine(i, k, v) { setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l))); }
  function addLine() { setLines((p) => [...p, { tipoLinha: "PARC", label: "", tipo: "D", conta: "", valor: "" }]); }
  function rmLine(i) { setLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p)); }

  const somaD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + num(l.valor), 0);
  const somaC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + num(l.valor), 0);

  async function submit() {
    setErro("");
    const clean = lines
      .filter((l) => String(l.conta).trim() || num(l.valor))
      .map((l) => ({ tipoLinha: l.tipoLinha || (l.tipo === "C" ? "PRINCIPAL" : "PARC"), tipo: l.tipo, conta: String(l.conta).trim(), valor: num(l.valor) }));
    if (!clean.length) { setErro("Preencha ao menos uma linha da rescisão."); return; }
    setBusy(true);
    try {
      await onConfirm({ rescisaoLines: clean, dataRescisao });
    } catch (e) { setErro(e?.message || "Falha ao rescindir."); }
    finally { setBusy(false); }
  }

  const lbl = { fontSize: "0.72rem", color: PANEL.muted, display: "block", marginBottom: 2 };
  const iconBtn = { background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.text, borderRadius: 6, width: 26, height: 26, lineHeight: "22px", textAlign: "center", cursor: "pointer", fontSize: "1rem", padding: 0 };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1700, padding: 16 }}>
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 20, width: "min(96vw, 900px)", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", overflowWrap: "anywhere", color: PANEL.text, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "1.0rem" }}>Rescindir — {parc?.label}</strong>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>
        {loading ? <div style={{ color: PANEL.muted, fontSize: "0.85rem" }}>Carregando…</div> : (
          <>
            <label style={{ maxWidth: 200 }}><span style={lbl}>Data da rescisão</span>
              <input type="date" value={dataRescisao} onChange={(e) => setDataRescisao(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }} />
            </label>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
              <div style={{ fontSize: "0.78rem", color: PANEL.muted }}>Linhas da rescisão</div>
              <button onClick={addLine} title="Adicionar linha" style={iconBtn}>+</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead><tr style={{ color: PANEL.muted }}>
                <th style={{ textAlign: "left", padding: 3 }}>Papel</th>
                <th style={{ padding: 3, width: 56 }}>D/C</th>
                <th style={{ padding: 3, width: 110 }}>Conta</th>
                <th style={{ padding: 3, width: 120, textAlign: "right" }}>Valor</th>
                <th style={{ width: 28 }} />
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ padding: 3 }}>
                      <select value={l.tipoLinha} onChange={(e) => setLine(i, "tipoLinha", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 3 }}>
                      <select value={l.tipo} onChange={(e) => setLine(i, "tipo", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                        <option value="D">D</option><option value="C">C</option>
                      </select>
                    </td>
                    <td style={{ padding: 3 }}>
                      <AccountCodeInput
                        value={l.conta}
                        onChange={(v) => setLine(i, "conta", v)}
                        accounts={accounts}
                        onSearchHistoricos={onSearchHistoricos}
                        onGetHistoricosByCode={onGetHistoricosByCode}
                        placeholder="—"
                      />
                    </td>
                    <td style={{ padding: 3 }}><input value={l.valor} onChange={(e) => setLine(i, "valor", e.target.value)} placeholder="0,00" style={{ ...FIELD_STYLE, padding: "4px 6px", textAlign: "right" }} /></td>
                    <td style={{ padding: 3, textAlign: "center" }}><button onClick={() => rmLine(i)} style={{ background: "transparent", border: "none", color: "#FF5757", cursor: "pointer" }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: "right", fontSize: "0.78rem", color: somaD === somaC ? PANEL.muted : "#FFB347" }}>
              Σ Débito: <strong style={{ color: PANEL.text }}>{fmtMoney(somaD)}</strong> · Σ Crédito: <strong style={{ color: PANEL.text }}>{fmtMoney(somaC)}</strong>
              {somaD !== somaC ? "  ⚠ D ≠ C" : ""}
            </div>
            {erro && <div style={{ color: "#FF5757", fontSize: "0.8rem" }}>{erro}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={onClose} disabled={saving || busy} style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.muted, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: "0.85rem" }}>Cancelar</button>
              <Button variant="danger" onClick={submit} disabled={saving || busy}>{saving || busy ? "Rescindindo…" : "Rescindir e lançar"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ParcelamentoCreateModal — criação stand-alone (sem guia de origem)
// ─────────────────────────────────────────────────────────────────────────
export function ParcelamentoCreateModal({
  accountingFunctions, // hook useAccountingFunctions (functions[], etc)
  saving, onCreate, onClose,
  // Se vier sourceGuide (guia que originou), modal mostra esse contexto
  // e cria a guia já linkada à 1ª parcela (entrada).
  sourceGuide = null,
  defaultLinkGuideAsParcelaNum = 1,
}) {
  useEscapeToClose(onClose);
  const [kind, setKind] = useState("SIMPLES");
  const [label, setLabel] = useState(sourceGuide ? `Parcelamento ${sourceGuide.tipo || ""} ${new Date().toLocaleDateString("pt-BR")}` : "");
  const [templateOpeningId, setTemplateOpeningId] = useState("");
  const [templatePaymentId, setTemplatePaymentId] = useState("");
  const [templateRescisionId, setTemplateRescisionId] = useState("");
  const [numParcelas, setNumParcelas] = useState(12);
  const [numEntradas, setNumEntradas] = useState(0);
  const [principalPerParcela, setPrincipalPerParcela] = useState("");
  const [principalTotal, setPrincipalTotal] = useState("");
  const [jurosTotal, setJurosTotal] = useState("");
  const [dataAbertura, setDataAbertura] = useState(new Date().toISOString().slice(0, 10));
  const [competenciaInicial, setCompetenciaInicial] = useState(
    sourceGuide?.competencia || new Date().toISOString().slice(0, 7)
  );
  const [diaPagamento, setDiaPagamento] = useState(20);
  const [periodosReferenciados, setPeriodosReferenciados] = useState("");
  const [linkGuideAsParcelaNum, setLinkGuideAsParcelaNum] = useState(defaultLinkGuideAsParcelaNum);
  const [err, setErr] = useState(null);

  const allFunctions = accountingFunctions?.functions || [];
  const openingTemplates = allFunctions.filter((f) => f.kind === "PARCELAMENTO_OPENING");
  const paymentTemplates = allFunctions.filter((f) => f.kind === "PARCELAMENTO_PAYMENT");
  const rescisionTemplates = allFunctions.filter((f) => f.kind === "PARCELAMENTO_RESCISION");

  // Auto-select templates baseado no kind (procura nome contendo o tipo)
  useEffect(() => {
    const match = (templates) => templates.find((t) => t.name.toUpperCase().includes(kind));
    setTemplateOpeningId((cur) => cur || match(openingTemplates)?.id || "");
    setTemplatePaymentId((cur) => cur || match(paymentTemplates)?.id || "");
    setTemplateRescisionId((cur) => cur || match(rescisionTemplates)?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, accountingFunctions?.functions]);

  // Preview: gera as N parcelas
  const preview = useMemo(() => {
    const n = Number(numParcelas) || 0;
    const principal = Number(principalPerParcela) || 0;
    const rows = [];
    for (let i = 1; i <= Math.min(n, 60); i++) {
      const comp = addMonths(competenciaInicial, i - 1);
      const isEntrada = i <= Number(numEntradas);
      rows.push({ numero: i, comp, principal, label: isEntrada ? `Entrada ${i}` : `Parc ${i}/${n}` });
    }
    return rows;
  }, [numParcelas, numEntradas, principalPerParcela, competenciaInicial]);

  const totalCalc = useMemo(() => {
    const pTotal = Number(principalTotal) || 0;
    const jTotal = Number(jurosTotal) || 0;
    if (pTotal > 0) return pTotal + jTotal;
    return (Number(principalPerParcela) || 0) * (Number(numParcelas) || 0);
  }, [principalTotal, jurosTotal, principalPerParcela, numParcelas]);

  async function handleCreate() {
    setErr(null);
    if (!label.trim()) return setErr("Label obrigatório.");
    // A abertura é obrigatória (é a única provisão da dívida) — exige template + principal total.
    if (!templateOpeningId) return setErr("Selecione um template de abertura.");
    if (!templatePaymentId) return setErr("Selecione um template de pagamento.");
    if (!numParcelas || numParcelas < 1) return setErr("Número de parcelas inválido.");
    if (!Number(principalPerParcela) || Number(principalPerParcela) <= 0) return setErr("Valor por parcela inválido.");
    if (!Number(principalTotal) || Number(principalTotal) <= 0) return setErr("Informe o principal total da dívida (vem do PDF da guia de abertura).");
    if (!competenciaInicial) return setErr("Competência inicial obrigatória.");
    try {
      await onCreate({
        label: label.trim(), kind,
        templateOpeningFunctionId: templateOpeningId,
        templatePaymentFunctionId: templatePaymentId,
        templateRescisionFunctionId: templateRescisionId || null,
        numEntradas: Number(numEntradas) || 0,
        numParcelas: Number(numParcelas),
        principalPerParcela: Number(principalPerParcela),
        principalTotal: Number(principalTotal),
        jurosTotal: Number(jurosTotal) || 0,
        dataAbertura,
        competenciaInicial,
        diaPagamento: Number(diaPagamento) || 1,
        periodosReferenciados: periodosReferenciados.trim() || null,
        sourceGuideId: sourceGuide?.guideId || sourceGuide?.id || null,
        linkGuideAsParcelaNum: sourceGuide ? Number(linkGuideAsParcelaNum) : null,
      });
    } catch (e) {
      setErr(e?.message || "Falha ao criar.");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1600,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
        padding: 20, width: "100%", maxWidth: 760, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: PANEL.text }}>
            Novo Parcelamento {sourceGuide ? "(a partir de guia)" : ""}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
              Tipo
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={FIELD_STYLE}>
                <option value="SIMPLES">SIMPLES NACIONAL</option>
                <option value="INSS">INSS</option>
                <option value="DARF">DARF</option>
                <option value="OUTRO">OUTRO</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
              Label
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: RE-PARCELAMENTO SIMPLES NACIONAL DE SET/2024..." style={FIELD_STYLE} />
            </label>
          </div>

          <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
              Templates (funções globais)
            </div>
            {openingTemplates.length === 0 && (
              <div style={{ marginBottom: 8, padding: "6px 10px", fontSize: "0.72rem", color: "#FFB347", background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", borderRadius: 6 }}>
                ⚠ Nenhum template de abertura disponível. Configure as funções de parcelamento antes de criar.
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
                Abertura *
                <select value={templateOpeningId} onChange={(e) => setTemplateOpeningId(e.target.value)} style={FIELD_STYLE}>
                  <option value="">— selecione —</option>
                  {openingTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
                Pagamento *
                <select value={templatePaymentId} onChange={(e) => setTemplatePaymentId(e.target.value)} style={FIELD_STYLE}>
                  <option value="">— selecione —</option>
                  {paymentTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
                Rescisão (opcional)
                <select value={templateRescisionId} onChange={(e) => setTemplateRescisionId(e.target.value)} style={FIELD_STYLE}>
                  <option value="">— sem rescisão —</option>
                  {rescisionTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Nº parcelas total
              <input type="number" min="1" value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} style={FIELD_STYLE} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Entradas (das primeiras)
              <input type="number" min="0" value={numEntradas} onChange={(e) => setNumEntradas(e.target.value)} style={FIELD_STYLE} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Valor por parcela
              <input type="number" step="0.01" min="0" value={principalPerParcela} onChange={(e) => setPrincipalPerParcela(e.target.value)} style={FIELD_STYLE} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Dia pagamento
              <input type="number" min="1" max="31" value={diaPagamento} onChange={(e) => setDiaPagamento(e.target.value)} style={FIELD_STYLE} />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Principal total RFB
              <input type="number" step="0.01" min="0" value={principalTotal} onChange={(e) => setPrincipalTotal(e.target.value)} placeholder="ex: 13.454,69" style={FIELD_STYLE} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Juros total RFB
              <input type="number" step="0.01" min="0" value={jurosTotal} onChange={(e) => setJurosTotal(e.target.value)} placeholder="ex: 3.600,89" style={FIELD_STYLE} />
            </label>
            <div style={{ alignSelf: "end", padding: "6px 10px", background: PANEL.field, borderRadius: 6, fontSize: "0.85rem", color: PANEL.text, textAlign: "right" }}>
              <span style={{ color: PANEL.muted, fontSize: "0.7rem" }}>Total: </span>
              <strong>R$ {fmtMoney(totalCalc)}</strong>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Data abertura
              <input type="date" value={dataAbertura} onChange={(e) => setDataAbertura(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Competência da 1ª parcela
              <input type="month" value={competenciaInicial} onChange={(e) => setCompetenciaInicial(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Períodos referenciados
              <input value={periodosReferenciados} onChange={(e) => setPeriodosReferenciados(e.target.value)} placeholder="SET/OUT/NOV/2024 E MAR/.../NOV/2025" style={FIELD_STYLE} />
            </label>
          </div>

          {sourceGuide && (
            <div style={{ background: "rgba(189,147,249,0.10)", border: "1px solid #BD93F9", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: "0.75rem", color: "#BD93F9", fontWeight: 700, marginBottom: 4 }}>
                📎 Esta guia será vinculada como uma parcela
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.75rem", color: PANEL.muted }}>
                Vincular como parcela número:
                <input type="number" min="1" max={numParcelas} value={linkGuideAsParcelaNum} onChange={(e) => setLinkGuideAsParcelaNum(e.target.value)} style={{ ...FIELD_STYLE, width: 80 }} />
                <span style={{ color: PANEL.muted, fontSize: "0.7rem" }}>(1 = entrada/1ª parcela; pode ser qualquer outra)</span>
              </label>
            </div>
          )}

          {preview.length > 0 && (
            <details style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10 }}>
              <summary style={{ cursor: "pointer", color: PANEL.text, fontSize: "0.8rem", fontWeight: 700 }}>
                Preview ({preview.length} parcelas)
              </summary>
              <div style={{ maxHeight: 200, overflowY: "auto", overflowX: "hidden", marginTop: 8, fontSize: "0.75rem", color: PANEL.text }}>
                {preview.map((p) => (
                  <div key={p.numero} style={{ display: "grid", gridTemplateColumns: "60px 100px 100px 1fr", gap: 8, padding: "2px 0", borderBottom: `1px solid ${PANEL.border}` }}>
                    <span style={{ color: PANEL.muted }}>{p.label}</span>
                    <span>{p.comp}</span>
                    <span style={{ textAlign: "right" }}>R$ {fmtMoney(p.principal)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {err && (
            <div style={{ color: "#FF4757", fontSize: "0.8rem", padding: "8px 10px", background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", borderRadius: 6 }}>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button variant="success" onClick={handleCreate} disabled={saving}>
              {saving ? "Criando…" : "Criar parcelamento"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ParcelamentosList — embed na Circular
// ─────────────────────────────────────────────────────────────────────────
// Q31: métrica compacta do card.
function ParcMetric({ label, value, accent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: "0.62rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: "0.85rem", fontWeight: 700, color: accent || PANEL.text }}>{value}</span>
    </div>
  );
}

export function ParcelamentosList({ parcelamentos, loading, onRescindir, onOpenCreate, getConfig, saveConfig, accounts = [], onSearchHistoricos, onGetHistoricosByCode }) {
  const [configParc, setConfigParc] = useState(null); // { id, label }
  const [rescParc, setRescParc] = useState(null);      // parcelamento sendo rescindido
  const [rescBusy, setRescBusy] = useState(false);

  if (loading) {
    return <div style={{ padding: 20, color: PANEL.muted, textAlign: "center" }}>Carregando parcelamentos…</div>;
  }
  if (!parcelamentos || parcelamentos.length === 0) {
    return (
      <div style={{ padding: 20, color: PANEL.muted, textAlign: "center", border: `1px dashed ${PANEL.border}`, borderRadius: 8 }}>
        Nenhum parcelamento ativo.{" "}
        {onOpenCreate && (
          <button onClick={onOpenCreate} style={{ background: "none", border: "none", color: "#BD93F9", cursor: "pointer", fontWeight: 700, textDecoration: "underline" }}>
            Criar parcelamento
          </button>
        )}
      </div>
    );
  }

  const statusColors = { ATIVO: "#69FF47", QUITADO: "#8BE9FD", RESCINDIDO: "#FF4757" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ color: PANEL.text, fontSize: "0.95rem" }}>Parcelamentos ({parcelamentos.length})</strong>
        {onOpenCreate && <Button size="sm" variant="success" onClick={onOpenCreate}>+ Novo</Button>}
      </div>

      {/* Cards (sem dropdown) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {parcelamentos.map((p) => {
          const pagas = p.parcelasPagas != null ? p.parcelasPagas : 0;
          const statusColor = statusColors[p.status] || PANEL.muted;
          return (
            <div key={p.id} style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ color: PANEL.text, fontWeight: 700, fontSize: "0.85rem" }}>{p.label}</div>
                <span style={{ flexShrink: 0, padding: "1px 6px", borderRadius: 999, background: `${statusColor}33`, color: statusColor, fontWeight: 700, fontSize: "0.62rem" }}>{p.status}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <ParcMetric label="Valor" value={`R$ ${fmtMoney(p.principalTotal)}`} />
                <ParcMetric label="Juros" value={`R$ ${fmtMoney(p.jurosTotal)}`} />
                <ParcMetric label="Consolidado" value={`R$ ${fmtMoney(p.totalValue)}`} accent="#8BE9FD" />
                <ParcMetric label="Valor da parcela" value={`R$ ${fmtMoney(p.principalPerParcela)}`} />
                <ParcMetric label="Parcelas pagas" value={`${pagas}/${p.numParcelas}`} />
                {p.status === "ATIVO" && (
                  <ParcMetric label="Falta" value={`R$ ${fmtMoney(p.saldoRestante != null ? p.saldoRestante : 0)}`} accent="#FFB347" />
                )}
              </div>

              {p.observacoes && (
                <div style={{ fontSize: "0.72rem", color: PANEL.muted, whiteSpace: "pre-wrap", borderTop: `1px solid ${PANEL.border}`, paddingTop: 8 }}>
                  <span style={{ color: PANEL.text, fontWeight: 600 }}>Descrição: </span>{p.observacoes}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: "auto" }}>
                {getConfig && saveConfig && (
                  <button
                    onClick={() => setConfigParc({ id: p.id, label: p.label })}
                    title="Configurar provisão/pagamento e descrição"
                    style={{ fontSize: "0.7rem", padding: "4px 10px", cursor: "pointer", background: "transparent", color: "#8BE9FD", border: "1px solid #8BE9FD", borderRadius: 4 }}
                  >
                    ⚙ Config
                  </button>
                )}
                {p.status === "ATIVO" && onRescindir && (
                  <button
                    onClick={() => setRescParc(p)}
                    style={{ fontSize: "0.7rem", padding: "4px 10px", cursor: "pointer", background: "transparent", color: "#FF4757", border: "1px solid #FF4757", borderRadius: 4 }}
                  >
                    Rescindir
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de configuração (provisão/pagamento + descrição). */}
      {configParc && getConfig && saveConfig && (
        <ParcelamentoConfigModal
          parcId={configParc.id}
          label={configParc.label}
          getConfig={getConfig}
          saveConfig={saveConfig}
          onClose={() => setConfigParc(null)}
          onSaved={() => setConfigParc(null)}
          accounts={accounts}
          onSearchHistoricos={onSearchHistoricos}
          onGetHistoricosByCode={onGetHistoricosByCode}
        />
      )}

      {/* Q31: modal de rescisão com 3 linhas pré-configuradas (estorno reverso). */}
      {rescParc && onRescindir && getConfig && (
        <ParcelamentoRescisaoModal
          parc={rescParc}
          getConfig={getConfig}
          saving={rescBusy}
          onConfirm={async (body) => {
            setRescBusy(true);
            try { await onRescindir(rescParc.id, body); setRescParc(null); }
            finally { setRescBusy(false); }
          }}
          onClose={() => setRescParc(null)}
          accounts={accounts}
          onSearchHistoricos={onSearchHistoricos}
          onGetHistoricosByCode={onGetHistoricosByCode}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Q28 Fase 3: ConferenciaParcelasPanel — fila de parcelas pagas a conferir / divergentes.
// Aprovar em lote confirma os lançamentos de baixa (RASCUNHO → CONFIRMADO).
// ─────────────────────────────────────────────────────────────────────────
export function ConferenciaParcelasPanel({ listConferencia, aprovarConferencia }) {
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    try { setItems(await listConferencia()); } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !items.length) return null; // só aparece quando há algo a conferir

  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function aprovar() {
    if (!sel.size) return;
    setBusy(true);
    try { await aprovarConferencia([...sel]); setSel(new Set()); await reload(); } finally { setBusy(false); }
  }

  return (
    <div style={{ background: PANEL.surface, border: "1px solid #FFB347", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${PANEL.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ color: "#FFB347", fontSize: "0.9rem" }}>Conferência de parcelas ({items.length})</strong>
        <Button size="sm" variant="success" onClick={aprovar} disabled={busy || !sel.size}>{busy ? "Aprovando…" : `Aprovar (${sel.size})`}</Button>
      </div>
      {items.map((it) => (
        <label key={it.guideId} style={{ display: "grid", gridTemplateColumns: "24px 1fr auto", gap: 10, alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${PANEL.border}`, cursor: it.estado === "PAGA_A_CONFERIR" ? "pointer" : "default" }}>
          <input type="checkbox" disabled={it.estado !== "PAGA_A_CONFERIR"} checked={sel.has(it.guideId)} onChange={() => toggle(it.guideId)} />
          <div style={{ fontSize: "0.78rem", color: PANEL.text }}>
            {it.parcelamentoLabel || "Parcelamento"} · parc {it.numeroParcela || "?"} · {it.competencia || it.anoMesParcela || ""}
            <span style={{ color: PANEL.muted, marginLeft: 8 }}>R$ {fmtMoney(it.valor)}</span>
          </div>
          <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: it.estado === "DIVERGENTE" ? "rgba(255,71,87,0.2)" : "rgba(255,179,71,0.2)", color: it.estado === "DIVERGENTE" ? "#FF4757" : "#FFB347" }}>{it.estado}</span>
        </label>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ParcelaPaymentModal — confirmar pagamento (só campo juros)
// ─────────────────────────────────────────────────────────────────────────
export function ParcelaPaymentModal({ parcelamento, parcela, saving, onConfirm, onClose }) {
  useEscapeToClose(onClose);
  const [jurosValor, setJurosValor] = useState("");
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState(null);

  const principal = Number(parcelamento?.principalPerParcela) || 0;
  const juros = Number(jurosValor) || 0;
  const total = principal + juros;

  async function handleConfirm() {
    setErr(null);
    try {
      await onConfirm({ jurosValor: juros, dataPagamento });
    } catch (e) {
      setErr(e?.message || "Falha ao confirmar.");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1700,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
        padding: 20, width: "100%", maxWidth: 480,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: PANEL.text, fontSize: "0.95rem" }}>
            Confirmar pagamento — Parc {String(parcela?.numeroParcela).padStart(2, "0")}/{parcelamento?.numParcelas}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ padding: 10, background: PANEL.field, borderRadius: 6, fontSize: "0.8rem", color: PANEL.text }}>
            <div><span style={{ color: PANEL.muted }}>Parcelamento:</span> {parcelamento?.label}</div>
            <div><span style={{ color: PANEL.muted }}>Competência:</span> {parcela?.competencia}</div>
            <div><span style={{ color: PANEL.muted }}>Principal (fixo):</span> R$ {fmtMoney(principal)}</div>
          </div>

          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
            Data do pagamento
            <input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }} />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
            Juros do mês (R$)
            <input type="number" step="0.01" min="0" value={jurosValor} onChange={(e) => setJurosValor(e.target.value)} placeholder="0,00" autoFocus style={{ ...FIELD_STYLE, fontWeight: 700, fontSize: "1rem", textAlign: "right" }} />
          </label>

          <div style={{ padding: 10, background: "rgba(105,255,71,0.10)", border: "1px solid #69FF47", borderRadius: 6, fontSize: "0.8rem", color: PANEL.text }}>
            <div style={{ fontSize: "0.7rem", color: "#69FF47", fontWeight: 700, marginBottom: 4 }}>Preview</div>
            <div>Principal → R$ {fmtMoney(principal)}</div>
            {juros > 0 && <div>Juros → R$ {fmtMoney(juros)}</div>}
            <div style={{ marginTop: 4, fontWeight: 700 }}>Total: R$ {fmtMoney(total)}</div>
          </div>

          {err && (
            <div style={{ color: "#FF4757", fontSize: "0.8rem", padding: "8px 10px", background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", borderRadius: 6 }}>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button variant="success" onClick={handleConfirm} disabled={saving}>
              {saving ? "Confirmando…" : "Confirmar pagamento"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// GuideLinkParcelamentoModal — "Esta guia é parcela?"
// ─────────────────────────────────────────────────────────────────────────
export function GuideLinkParcelamentoModal({
  guide, parcelamentos, accountingFunctions,
  saving, onLink, onCreateAndLink, onSkip, onClose,
}) {
  useEscapeToClose(onClose);
  const [option, setOption] = useState("none"); // none | existing | new
  const [selectedParcId, setSelectedParcId] = useState("");
  const [numeroParcela, setNumeroParcela] = useState(1);
  const [showCreateInline, setShowCreateInline] = useState(false);
  const [err, setErr] = useState(null);

  const ativos = (parcelamentos || []).filter((p) => p.status === "ATIVO");
  const selectedParc = ativos.find((p) => p.id === selectedParcId);

  // Sugere a parcela mais provável quando seleciona parcelamento existente
  useEffect(() => {
    if (option !== "existing" || !selectedParc || !guide?.competencia) return;
    // procura parcela com competencia == guide.competencia
    const match = (selectedParc.parcelas || []).find((p) => p.competencia === guide.competencia);
    if (match) setNumeroParcela(match.numeroParcela);
  }, [option, selectedParcId, selectedParc, guide?.competencia]);

  async function handleSubmit() {
    setErr(null);
    try {
      if (option === "none") {
        await onSkip();
      } else if (option === "existing") {
        if (!selectedParcId) return setErr("Selecione um parcelamento.");
        await onLink(selectedParcId, Number(numeroParcela));
      } else if (option === "new") {
        setShowCreateInline(true);
        return;
      }
    } catch (e) {
      setErr(e?.message || "Falha ao processar.");
    }
  }

  if (showCreateInline) {
    return (
      <ParcelamentoCreateModal
        accountingFunctions={accountingFunctions}
        saving={saving}
        sourceGuide={guide}
        onCreate={onCreateAndLink}
        onClose={() => setShowCreateInline(false)}
      />
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1650,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
        padding: 20, width: "100%", maxWidth: 560,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: PANEL.text, fontSize: "0.95rem" }}>
            Esta guia é parcela de algum parcelamento?
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <div style={{ padding: 10, background: PANEL.field, borderRadius: 6, fontSize: "0.8rem", color: PANEL.text, marginBottom: 12 }}>
          <div><span style={{ color: PANEL.muted }}>Guia:</span> {guide?.tipo} · {guide?.competencia} · R$ {fmtMoney(guide?.valor)}</div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: 10, border: `1px solid ${option === "none" ? "#69FF47" : PANEL.border}`, borderRadius: 6, cursor: "pointer", background: option === "none" ? "rgba(105,255,71,0.08)" : "transparent" }}>
            <input type="radio" checked={option === "none"} onChange={() => setOption("none")} style={{ marginTop: 2 }} />
            <div>
              <div style={{ color: PANEL.text, fontSize: "0.8rem", fontWeight: 700 }}>Não, é guia normal</div>
            </div>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: 10, border: `1px solid ${option === "existing" ? "#69FF47" : PANEL.border}`, borderRadius: 6, cursor: "pointer", background: option === "existing" ? "rgba(105,255,71,0.08)" : "transparent" }}>
            <input type="radio" checked={option === "existing"} onChange={() => setOption("existing")} style={{ marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: PANEL.text, fontSize: "0.8rem", fontWeight: 700 }}>Sim, vincular a parcelamento EXISTENTE</div>
              {option === "existing" && (
                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  <select value={selectedParcId} onChange={(e) => setSelectedParcId(e.target.value)} style={FIELD_STYLE}>
                    <option value="">— selecione um parcelamento ativo —</option>
                    {ativos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} ({p.kind}, {p.numParcelas}x, R$ {fmtMoney(p.totalValue)})
                      </option>
                    ))}
                  </select>
                  {selectedParc && (
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.75rem", color: PANEL.muted }}>
                      Parcela:
                      <input type="number" min="1" max={selectedParc.numParcelas} value={numeroParcela} onChange={(e) => setNumeroParcela(e.target.value)} style={{ ...FIELD_STYLE, width: 80 }} />
                    </label>
                  )}
                </div>
              )}
            </div>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: 10, border: `1px solid ${option === "new" ? "#69FF47" : PANEL.border}`, borderRadius: 6, cursor: "pointer", background: option === "new" ? "rgba(105,255,71,0.08)" : "transparent" }}>
            <input type="radio" checked={option === "new"} onChange={() => setOption("new")} style={{ marginTop: 2 }} />
            <div>
              <div style={{ color: PANEL.text, fontSize: "0.8rem", fontWeight: 700 }}>Sim, esta guia é a ABERTURA de um NOVO parcelamento</div>
            </div>
          </label>

          {err && (
            <div style={{ color: "#FF4757", fontSize: "0.8rem", padding: "8px 10px", background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", borderRadius: 6 }}>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button variant="success" onClick={handleSubmit} disabled={saving}>
              {option === "new" ? "Continuar para criação…" : "Confirmar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
