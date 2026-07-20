import { useEffect, useState, useMemo } from "react";
import { BaixaModal } from "../../baixa/components/renderBaixaModal";
import { SmartHistoricoInput, LineEditor, hasDuplicateAccountAcrossSides } from "../../entries/components/renderAccountingEntriesParts";
import { ACCOUNTING_PANEL, PANEL_FIELD_STYLE, SUBTIPO_OPTIONS } from "../../entries/lib/accountingEntriesShared";

// Subtipos universais + flag de regimes que os exibem.
// "all" = qualquer regime; array = só esses regimes.
// Simples NÃO tem IRPJ/CSLL/PIS_COFINS/ISS (esses são exclusivos de Presumido/Real).
// Presumido/Real NÃO tem DAS (esse é exclusivo de Simples).
const SUBTIPO_ROWS_ALL = [
  { key: "DAS",             label: "DAS / Simples Nacional",        regimes: ["SIMPLES"] },
  // PARC_DAS — parcelamento Simples Nacional. Aparece logo abaixo de DAS por proximidade temática.
  // Só faz sentido para empresas regime SIMPLES (que pagam DAS via Simples Nacional).
  { key: "PARC_DAS",        label: "Parc. Simples Nacional",        regimes: ["SIMPLES"] },
  { key: "IRPJ",            label: "IRPJ",                          regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "CSLL",            label: "CSLL",                          regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "PIS_COFINS",      label: "PIS/COFINS",                    regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "ISS",             label: "ISS",                           regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "INSS",            label: "INSS / CPP",                    regimes: "all" },
  { key: "IRRF",            label: "IRRF",                          regimes: "all" },
  { key: "FGTS",            label: "FGTS",                          regimes: "all" },
  { key: "FERIAS",          label: "Férias",                        regimes: "all" },
  { key: "DECIMO_TERCEIRO", label: "13º Salário",                   regimes: "all" },
  { key: "OUTROS_TRIBUTOS", label: "Outros Tributos",               regimes: "all" },
];

function getSubtipoRowsForRegime(regime) {
  const r = String(regime || "").trim().toUpperCase();
  if (!r) return SUBTIPO_ROWS_ALL;  // sem regime conhecido → mostra tudo (fallback)
  return SUBTIPO_ROWS_ALL.filter(
    (row) => row.regimes === "all" || row.regimes.includes(r),
  );
}

// Mantido como fallback para código legado que ainda importava esta constante.
const SUBTIPO_ROWS = SUBTIPO_ROWS_ALL;

// Frente B: subtipo da matriz → chave(s) do tributo em circular.acrescimos.
// PIS_COFINS agrega PIS + COFINS (a matriz tem uma linha só).
const SUBTIPO_TO_ACRESCIMO = {
  DAS: ["DAS"], INSS: ["INSS"], IRPJ: ["IRPJ"], CSLL: ["CSLL"], PIS_COFINS: ["PIS", "COFINS"], ISS: ["ISS"],
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Q31: largura ÚNICA de coluna do quadro (todas iguais — header, célula, subtotal).
const COL_W = 120;

const TIPO_LABELS = { DESPESA: "Despesa", RECEITA: "Receita", FOLHA: "Folha", PROVISAO: "Provisão", BAIXA: "Baixa", OUTRO: "Outro" };

function fmtMoney(val) {
  const n = Number(val);
  if (!n) return null;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

// ─── Entry Edit Modal ────────────────────────────────────────────────────────

function CircularEntryEditModal({ entry, accounts, saving, onSave, onClose, onSearchHistoricos, acrescimosComp }) {
  const [form, setForm] = useState({
    data: entry.data ? String(entry.data).slice(0, 10) : "",
    historico: entry.historico || "",
    tipo: entry.tipo || "PROVISAO",
    subtipo: entry.subtipo || "",
    lines: (entry.lines || []).map((l) => ({
      tipo: l.tipo,
      conta: l.conta || "",
      valor: String(Number(l.valor || 0).toFixed(2)),
    })),
  });
  const [saveError, setSaveError] = useState(null);

  const isDuplicate = hasDuplicateAccountAcrossSides(form.lines);
  const subtipoLabel = SUBTIPO_ROWS.find((r) => r.key === entry.subtipo)?.label || entry.subtipo || "Lançamento";

  // Acréscimo (juros/multa) — e, p/ INSS sintético, o valor principal — editado no MESMO modal.
  // INSS não tem lançamento real (synthetic): modo "acréscimo-only" edita só valor/juros/multa.
  const isAcrOnly = entry.synthetic === true;
  const acrKeys = SUBTIPO_TO_ACRESCIMO[entry.subtipo] || [];
  const [acr, setAcr] = useState(() =>
    acrKeys.map((k) => {
      const src = (acrescimosComp && acrescimosComp[k]) || {};
      return {
        key: k,
        principal: src.principal != null ? String(src.principal) : (isAcrOnly && src.principal == null ? String(Number(entry.valor || entry.totalD || 0).toFixed(2)) : ""),
        juros: src.juros != null ? String(src.juros) : "",
        multa: src.multa != null ? String(src.multa) : "",
      };
    }),
  );
  const setAcrField = (i, field, val) => setAcr((p) => p.map((t, idx) => (idx === i ? { ...t, [field]: val } : t)));
  // Payload do acréscimo: real → só juros/multa (principal preservado no parent); INSS → inclui principal.
  const buildAcrescimo = () => acr.map((t) => (isAcrOnly ? { key: t.key, principal: t.principal, juros: t.juros, multa: t.multa } : { key: t.key, juros: t.juros, multa: t.multa }));

  // Detecta linhas com conta vazia — ajuda o contador a entender por que o save vai falhar.
  const linesWithEmptyConta = form.lines.filter((l) => !String(l.conta || "").trim()).length;
  const linesWithoutValor = form.lines.filter((l) => {
    const v = parseFloat(String(l.valor || "0").replace(",", "."));
    return !Number.isFinite(v) || v <= 0;
  }).length;

  async function handleSave() {
    setSaveError(null);
    // INSS sintético: não há lançamento pra validar/atualizar — salva só valor/juros/multa.
    if (isAcrOnly) {
      try {
        await onSave({ acrescimoOnly: true, acrescimoTributos: buildAcrescimo() });
      } catch (err) {
        setSaveError(err?.message || "Falha ao salvar.");
      }
      return;
    }
    if (isDuplicate) return;
    if (linesWithEmptyConta > 0) {
      setSaveError(`Há ${linesWithEmptyConta} linha(s) sem código de conta. Preencha as contas antes de salvar.`);
      return;
    }
    if (linesWithoutValor > 0) {
      setSaveError(`Há ${linesWithoutValor} linha(s) sem valor (ou com valor ≤ 0).`);
      return;
    }
    try {
      // passa também o eventType (pra backend memorizar D/C no AccountingHistorico) + acréscimo
      await onSave({ ...form, eventType: entry.eventType || null, acrescimoTributos: buildAcrescimo() });
    } catch (err) {
      setSaveError(err?.message || "Falha ao salvar lançamento.");
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: ACCOUNTING_PANEL.surface, border: `1px solid ${ACCOUNTING_PANEL.border}`, borderRadius: 10, padding: 20, width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 700, color: ACCOUNTING_PANEL.text, fontSize: "0.9375rem" }}>
            Editar: {subtipoLabel}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: ACCOUNTING_PANEL.muted, cursor: "pointer", fontSize: "1.4rem", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {!isAcrOnly && (<>
          {/* Data */}
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
            Data
            <input
              type="date"
              value={form.data}
              onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))}
              style={{ ...PANEL_FIELD_STYLE, colorScheme: "dark", height: 34, padding: "0 10px" }}
            />
          </label>

          {/* Histórico */}
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
            Histórico
            <SmartHistoricoInput
              value={form.historico}
              onChange={(v) => setForm((p) => ({ ...p, historico: v }))}
              onFillFromHistory={(h, ls) =>
                setForm((p) => ({
                  ...p,
                  historico: h,
                  lines: ls?.length
                    ? ls.map((l) => ({ tipo: l.tipo, conta: l.conta || "", valor: l.valor ? String(l.valor) : "" }))
                    : p.lines,
                }))
              }
              onSearchHistoricos={onSearchHistoricos}
              accounts={accounts}
              competencia={entry.competencia}
            />
          </label>

          {/* Tipo + Subtipo */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
              Tipo
              <select
                value={form.tipo}
                onChange={(e) =>
                  setForm((p) => ({ ...p, tipo: e.target.value, subtipo: e.target.value !== "PROVISAO" ? "" : p.subtipo }))
                }
                style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", colorScheme: "dark" }}
              >
                {Object.entries(TIPO_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            {form.tipo === "PROVISAO" && (
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
                Subtipo
                <select
                  value={form.subtipo || ""}
                  onChange={(e) => setForm((p) => ({ ...p, subtipo: e.target.value }))}
                  style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", colorScheme: "dark" }}
                >
                  <option value="">—</option>
                  {SUBTIPO_OPTIONS.map(({ key, label }) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Linhas */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted, marginBottom: 4 }}>Linhas (D/C)</div>
            {/* Colunas fixas do LineEditor: em telas estreitas rola só aqui, não o modal todo. */}
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <LineEditor
                lines={form.lines}
                onChange={(ls) => setForm((p) => ({ ...p, lines: ls }))}
                accounts={accounts}
              />
            </div>
          </div>
          </>)}

          {/* Acréscimo: juros/multa (e o valor principal, no caso do INSS sintético) */}
          {acr.length > 0 && (
            <div style={{ display: "grid", gap: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(255,179,71,0.06)", border: "1px solid rgba(255,179,71,0.35)" }}>
              {acr.map((t, i) => (
                <div key={t.key} style={{ display: "grid", gap: 6 }}>
                  {acr.length > 1 && <strong style={{ color: ACCOUNTING_PANEL.text, fontSize: "0.78rem" }}>{t.key}</strong>}
                  <div style={{ display: "grid", gridTemplateColumns: isAcrOnly ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8 }}>
                    {isAcrOnly && (
                      <label style={{ display: "grid", gap: 3, fontSize: "0.7rem", color: ACCOUNTING_PANEL.muted }}>
                        Valor
                        <input value={t.principal} onChange={(e) => setAcrField(i, "principal", e.target.value)} placeholder="0,00" style={{ ...PANEL_FIELD_STYLE, width: "100%" }} />
                      </label>
                    )}
                    <label style={{ display: "grid", gap: 3, fontSize: "0.7rem", color: "#FFB347" }}>
                      Juros
                      <input value={t.juros} onChange={(e) => setAcrField(i, "juros", e.target.value)} placeholder="0,00" style={{ ...PANEL_FIELD_STYLE, width: "100%" }} />
                    </label>
                    <label style={{ display: "grid", gap: 3, fontSize: "0.7rem", color: "#FFB347" }}>
                      Multa
                      <input value={t.multa} onChange={(e) => setAcrField(i, "multa", e.target.value)} placeholder="0,00" style={{ ...PANEL_FIELD_STYLE, width: "100%" }} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isAcrOnly && isDuplicate && (
            <div style={{ color: "#FF4757", fontSize: "0.8125rem", fontWeight: 600 }}>
              Débito e crédito não podem usar a mesma conta.
            </div>
          )}
          {saveError && (
            <div style={{
              color: "#FF4757", fontSize: "0.8125rem", fontWeight: 600,
              padding: "8px 10px", borderRadius: 6,
              background: "rgba(255, 71, 87, 0.12)", border: "1px solid #FF4757",
            }}>
              {saveError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={onClose}
              style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 16px", cursor: "pointer", borderRadius: 4 }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (!isAcrOnly && isDuplicate)}
              style={{
                height: 34, padding: "0 20px",
                background: "#69FF47", color: "#1A1B26",
                border: "none", borderRadius: 4,
                fontWeight: 700, fontSize: "0.875rem",
                cursor: saving || (!isAcrOnly && isDuplicate) ? "default" : "pointer",
                opacity: saving || (!isAcrOnly && isDuplicate) ? 0.6 : 1,
              }}
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PagamentoCell ───────────────────────────────────────────────────────────

// Q31: célula só com NÚMERO; cor implícita (vermelho=aberto, verde=pago, amarelo=vinculado a
// parcelamento). Clicar abre o menu de ações (Editar / Dar baixa / Vincular a parcelamento).
function PagamentoCell({ entry, onBaixa, onEdit, onCancelBaixa, parcelamentosAtivos = [], onVincular, onDesvincular, acrescimo = null }) {
  const [open, setOpen] = useState(false);
  const [selParc, setSelParc] = useState("");
  const temAcrescimo = acrescimo && acrescimo.acrescimo > 0;

  // Célula sem provisão: mostra "—" (ou o split, se houver — ex.: LP sem lançamento ainda).
  if (!entry) {
    if (!acrescimo) {
      return <td style={{ width: COL_W, minWidth: COL_W, padding: "8px 4px", textAlign: "center", fontSize: "0.85rem", color: "#44475A", borderRight: "1px solid #44475A" }}>—</td>;
    }
    return (
      <td style={{ width: COL_W, minWidth: COL_W, padding: "8px 4px", textAlign: "center", borderRight: "1px solid #44475A", color: "#F8F8F2" }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", whiteSpace: "nowrap" }}>R$ {fmtMoney(acrescimo.principal) || "0,00"}</div>
        {temAcrescimo && <div title={`Juros/multa R$ ${fmtMoney(acrescimo.acrescimo)}`} style={{ fontSize: "0.6rem", fontWeight: 700, color: "#FFB347", whiteSpace: "nowrap" }}>+R$ {fmtMoney(acrescimo.acrescimo)} j/m</div>}
      </td>
    );
  }

  const placeholder = entry.placeholder || entry.origem === "TEMPLATE";
  const isAberto = entry.statusPagamento === "ABERTO";
  const isParcial = entry.statusPagamento === "PARCIAL"; // baixa parcial por quota — ainda tem saldo
  const isOpenLike = isAberto || isParcial; // pode receber (nova) baixa
  const isVinculado = Boolean(entry.parcelamentoId);
  const isSynthetic = entry.synthetic === true;
  const valor = entry.valor || entry.totalD;
  // baixas existem quando parcial ou pago; usado tanto p/ cancelar a última quota quanto p/ INSS.
  const baixaId = entry.baixas?.[0]?.id ?? null;
  const saldo = Number(entry.saldo);

  // Cor implícita do número:
  let color = "#FF4757"; let bg = "rgba(255,71,87,0.06)"; // em aberto (vermelho)
  if (placeholder) { color = "#6272A4"; bg = "transparent"; }
  else if (isParcial) { color = "#6EA8FF"; bg = "rgba(110,168,255,0.08)"; } // parcial (azul)
  else if (!isAberto) { color = "#69FF47"; bg = "rgba(105,255,71,0.06)"; } // pago (verde)
  else if (isVinculado) { color = "#FFB347"; bg = "rgba(255,179,71,0.08)"; } // vinculado a parcelamento (amarelo)

  const menuBtn = { display: "block", width: "100%", textAlign: "left", padding: "6px 8px", background: "transparent", border: "none", color: "#F8F8F2", fontSize: "0.78rem", cursor: "pointer", borderRadius: 4 };

  // Lançamentos reais: editar/baixar/vincular. INSS sintético (vem da guia) agora tem o fluxo
  // completo igual ao DAS (Q52): "Dar baixa" (abre modal, gera a baixa contábil), "Editar baixa"
  // (edita o lançamento gerado) e "Cancelar baixa" (apaga a baixa e reabre a guia).
  const canBaixaInss = isSynthetic && isAberto && Boolean(onBaixa);
  // INSS aberto: pode editar valor/juros/multa (não há lançamento — vai p/ acrescimos.INSS).
  const canEditInss = isSynthetic && isAberto && Boolean(onEdit);
  // INSS pago: pode editar a baixa (entry.baixaEntry é o lançamento real) e cancelá-la.
  const canManageInssBaixa = isSynthetic && !isAberto && Boolean(baixaId);
  const hasActions =
    canBaixaInss
    || canEditInss
    || (canManageInssBaixa && (Boolean(onCancelBaixa) || (Boolean(onEdit) && Boolean(entry.baixaEntry))))
    || (!isSynthetic && (Boolean(onEdit) || (isOpenLike && Boolean(onBaixa)) || (Boolean(baixaId) && Boolean(onCancelBaixa)) || Boolean(onVincular)));
  const numText = fmtMoney(valor) ? `R$ ${fmtMoney(valor)}` : "—";

  return (
    <td style={{ position: "relative", background: bg, padding: "8px 4px", textAlign: "center", borderRight: "1px solid #44475A", width: COL_W, minWidth: COL_W, color: "#F8F8F2" }}>
      {hasActions ? (
        <button
          onClick={() => setOpen((o) => !o)}
          title={isVinculado ? "Vinculado a parcelamento" : (isParcial ? `Parcial — saldo R$ ${fmtMoney(saldo)}` : (isAberto ? "Em aberto" : "Pago"))}
          style={{ background: "transparent", border: "none", cursor: "pointer", color, fontWeight: 700, fontSize: "0.95rem", whiteSpace: "nowrap", width: "100%", padding: "2px 0" }}
        >
          {numText}
        </button>
      ) : (
        <span
          title={isSynthetic ? "Gerada a partir da guia INSS — gerencie o pagamento na aba Guias" : (isParcial ? `Parcial — saldo R$ ${fmtMoney(saldo)}` : (isAberto ? "Em aberto" : "Pago"))}
          style={{ color, fontWeight: 700, fontSize: "0.95rem", whiteSpace: "nowrap", display: "inline-block", padding: "2px 0" }}
        >
          {numText}
        </span>
      )}
      {entry.recalculatedAt && entry.recalculatedToValor != null && (
        <div
          style={{ fontSize: "0.6rem", fontWeight: 700, color: "#FFB347", whiteSpace: "nowrap" }}
          title={`Guia recalculada em ${fmtDate(entry.recalculatedAt)}. Valor original: R$ ${fmtMoney(entry.recalculatedFromValor)}. Atualizado: R$ ${fmtMoney(entry.recalculatedToValor)}.`}
        >
          ↻ R$ {fmtMoney(entry.recalculatedToValor)}
        </div>
      )}
      {/* Frente B: acréscimo (juros/multa) destacado + edição do split principal/juros/multa. */}
      {temAcrescimo && (
        <div title={`Valor original R$ ${fmtMoney(acrescimo.principal)} + juros/multa R$ ${fmtMoney(acrescimo.acrescimo)}`} style={{ fontSize: "0.6rem", fontWeight: 700, color: "#FFB347", whiteSpace: "nowrap" }}>
          +R$ {fmtMoney(acrescimo.acrescimo)} j/m
        </div>
      )}
      {/* Baixa parcial por quota: mostra o saldo restante (azul) na célula. */}
      {!placeholder && isParcial && Number.isFinite(saldo) && (
        <div style={{ fontSize: "0.6rem", fontWeight: 700, color: "#6EA8FF", whiteSpace: "nowrap" }} title={`Pago R$ ${fmtMoney(entry.abatido)} de R$ ${fmtMoney(valor)} — ${entry.quotasPagas || 0} quota(s)`}>
          saldo R$ {fmtMoney(saldo)}
        </div>
      )}
      {/* Ícone único de "pago" — só quando totalmente quitado (baixa manual ou confirmação SERPRO).
          Só indicador visual (não clicável); o tooltip traz data/origem quando houver. */}
      {!placeholder && !isOpenLike && (
        <div
          style={{ fontSize: "0.85rem", lineHeight: 1.1 }}
          title={`Pagamento confirmado${entry.sourceGuide?.paymentConfirmedAt ? ` em ${fmtDate(entry.sourceGuide.paymentConfirmedAt)}` : ""}${entry.sourceGuide?.paymentStatusSource === "SERPRO" ? " (via SERPRO)" : ""}${entry.sourceGuide?.comprovantePdfFileId ? " — comprovante de arrecadação disponível" : ""}.`}
        >
          ✅
        </div>
      )}
      {open && hasActions && (
        <div
          onMouseLeave={() => setOpen(false)}
          style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", zIndex: 50, background: "#24253A", border: "1px solid #44475A", borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.45)", padding: 6, minWidth: 190, display: "flex", flexDirection: "column", gap: 2 }}
        >
          {onEdit && !isSynthetic && <button onClick={() => { setOpen(false); onEdit(entry); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>✎ Editar</button>}
          {/* INSS sintético aberto: edita valor/juros/multa (vai p/ acrescimos.INSS) no mesmo modal. */}
          {canEditInss && <button onClick={() => { setOpen(false); onEdit(entry); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>✎ Editar valor/juros/multa</button>}
          {/* Q52: INSS pago — edita o lançamento de baixa real (não a provisão sintética). */}
          {onEdit && isSynthetic && !isAberto && entry.baixaEntry && <button onClick={() => { setOpen(false); onEdit(entry.baixaEntry); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>✎ Editar baixa</button>}
          {/* "Dar baixa" — provisões reais E INSS sintético (Q47). Em PARCIAL, abre nova quota. */}
          {isOpenLike && onBaixa && <button onClick={() => { setOpen(false); onBaixa(entry); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>{isParcial ? "Dar baixa (próxima quota)" : "Dar baixa"}</button>}
          {/* "Cancelar baixa" — DAS/quota (provisão real) E INSS sintético (Q52). Em PARCIAL cancela a última quota. */}
          {baixaId && onCancelBaixa && <button onClick={() => { setOpen(false); onCancelBaixa(baixaId); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>{isParcial ? "Cancelar última quota" : "Cancelar baixa"}</button>}
          {onVincular && !isSynthetic && (
            isVinculado ? (
              <button onClick={() => { setOpen(false); onDesvincular(entry); }} style={{ ...menuBtn, color: "#FFB347" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>Desvincular do parcelamento</button>
            ) : (
              <div style={{ borderTop: `1px solid #44475A`, marginTop: 2, paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <select value={selParc} onChange={(e) => setSelParc(e.target.value)} style={{ background: "#1A1B26", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2", padding: "4px 6px", fontSize: "0.72rem", colorScheme: "dark" }}>
                  <option value="">— parcelamento —</option>
                  {parcelamentosAtivos.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <button disabled={!selParc} onClick={() => { if (selParc) { setOpen(false); onVincular(entry, selParc); } }} style={{ ...menuBtn, color: selParc ? "#FFB347" : "#6272A4", cursor: selParc ? "pointer" : "default" }}>Vincular a parcelamento</button>
              </div>
            )
          )}
        </div>
      )}
    </td>
  );
}

function FaturamentoCell({ valor }) {
  return (
    <td style={{ padding: "6px 4px", textAlign: "center", fontSize: "0.75rem", borderRight: "1px solid #44475A" }}>
      {valor ? (
        <span style={{ fontWeight: 700, color: "#8BE9FD" }}>R$ {fmtMoney(valor)}</span>
      ) : (
        <span style={{ color: "#44475A" }}>—</span>
      )}
    </td>
  );
}

// Q7.2: painel "Operações Fiscais" foi removido — as ações (Buscar Guias, Verificar Pagtos,
// Sincronizar INSS) ficam nas abas Guias / Configurações. Circular foca só na tabela.

// ─── CircularTab ─────────────────────────────────────────────────────────────

export function CircularTab({
  circularData,
  loading,
  year,
  competencia,
  onCompetenciaChange,
  onYearChange,
  onLoad,
  accounts,
  companyRegime,  // regime tributário da empresa: filtra linhas exibidas (DAS só Simples; IRPJ/CSLL/PIS_COFINS/ISS só Presumido)
  onCreateBaixa,
  savingBaixa,
  onLoadBaixaTemplate,
  error,
  message,
  onUpdateEntry,
  onSearchHistoricos,
  onGetHistoricosByCode, // sugestão de contas por código no config de parcelamento
  onCancelBaixa,
  parcelamentos, // Q9: hook completo (parcelamentos, payParcela, rescindir, etc)
  onSaveCircular, // Frente B: salva acrescimos (principal/juros/multa) da circular
  savingCircular,
}) {
  const [baixaEntry, setBaixaEntry] = useState(null);
  const [editEntry, setEditEntry] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancellingBaixaId, setCancellingBaixaId] = useState(null);
  const currentYear = new Date().getFullYear();

  // Q31: o quadro NÃO mostra os lançamentos do parcelamento (subtipo PARC_*) — eles ficam só nos
  // cards de parcelamento abaixo. (Competências DAS/INSS vinculadas a um parcelamento continuam, em amarelo.)
  const quadroProvisoes = useMemo(
    () => (circularData?.provisoes || []).filter((p) => !String(p.subtipo || "").toUpperCase().startsWith("PARC")),
    [circularData],
  );

  const matrix = useMemo(() => {
    const map = {};
    for (const p of quadroProvisoes) {
      if (!p.subtipo) continue;
      const k = `${p.subtipo}__${p.competencia}`;
      const existing = map[k];
      if (!existing) { map[k] = p; continue; }
      const isTemplate = (e) => e.placeholder || e.origem === "TEMPLATE";
      if (isTemplate(existing) && !isTemplate(p)) { map[k] = p; continue; }
      // Provisão ainda com saldo (ABERTO ou PARCIAL) prevalece sobre uma duplicata PAGA.
      if (!isTemplate(existing) && ["ABERTO", "PARCIAL"].includes(p.statusPagamento) && !isTemplate(p)) { map[k] = p; }
    }
    return map;
  }, [quadroProvisoes]);

  // Linhas da matriz são filtradas em 2 passos:
  // 1) Por regime tributário da empresa (Simples não tem IRPJ/CSLL/etc; Presumido não tem DAS)
  // 2) Apenas linhas que tenham pelo menos 1 entrada com dados (estética — esconde linhas vazias)
  const visibleRows = useMemo(() => {
    const byRegime = getSubtipoRowsForRegime(companyRegime);
    const usedSubtipos = new Set(quadroProvisoes.map((p) => p.subtipo).filter(Boolean));
    return byRegime.filter((r) => usedSubtipos.has(r.key));
  }, [quadroProvisoes, companyRegime]);

  const abertoByMonth = useMemo(() => {
    const totals = {};
    for (const p of quadroProvisoes) {
      if (p.placeholder || p.origem === "TEMPLATE") continue;
      if (p.statusPagamento === "ABERTO") {
        totals[p.competencia] = (totals[p.competencia] || 0) + (Number(p.totalD) || 0);
      } else if (p.statusPagamento === "PARCIAL") {
        // Parcial conta só o SALDO restante como "em aberto".
        totals[p.competencia] = (totals[p.competencia] || 0) + (Number(p.saldo) || 0);
      }
    }
    return totals;
  }, [quadroProvisoes]);

  const monthKeys = MONTH_LABELS.map((_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  // Q31: quadro transposto — meses nas linhas, impostos nas colunas (+ Faturamento, Total em aberto).
  // Valor numérico de uma coluna num mês (impostos via matrix; colunas especiais por chave).
  const yy = String(year).slice(2);
  const cellNum = (colKey, comp) => {
    if (colKey === "__FAT__") return Number(circularData?.receitas?.[comp]) || 0;
    if (colKey === "__ABERTO__") return Number(abertoByMonth[comp]) || 0;
    const e = matrix[`${colKey}__${comp}`];
    return e ? Number(e.totalD || e.valor || 0) : 0;
  };
  const sumQuarter = (colKey, qi) => monthKeys.slice(qi * 3, qi * 3 + 3).reduce((s, c) => s + cellNum(colKey, c), 0);
  const sumYear = (colKey) => monthKeys.reduce((s, c) => s + cellNum(colKey, c), 0);

  // Q31: parcelamentos ativos (pra vincular competências) + handlers de vínculo (só marca).
  const parcelamentosAtivos = (parcelamentos?.parcelamentos || []).filter((p) => p.status === "ATIVO");
  async function handleVincular(entry, parcId) {
    if (!parcelamentos?.vincularEntry) return;
    await parcelamentos.vincularEntry(entry.id, parcId);
    await onLoad(year, competencia);
  }
  async function handleDesvincular(entry) {
    if (!parcelamentos?.vincularEntry) return;
    await parcelamentos.vincularEntry(entry.id, null);
    await onLoad(year, competencia);
  }

  // Estilos do quadro transposto — TODAS as colunas com a mesma largura (COL_W).
  const headCellStyle = { width: COL_W, minWidth: COL_W, padding: "8px 6px", textAlign: "center", fontSize: "0.82rem", fontWeight: 700, color: "#F8F8F2", letterSpacing: "0.01em", borderRight: "1px solid #44475A", borderBottom: "2px solid #44475A", lineHeight: 1.2 };
  const headStickyStyle = { ...headCellStyle, textAlign: "center", position: "sticky", left: 0, background: "#282A36", zIndex: 10 };
  const monthStickyStyle = { width: COL_W, minWidth: COL_W, padding: "8px 8px", fontWeight: 700, fontSize: "0.9rem", textAlign: "center", borderRight: "2px solid #44475A", borderBottom: "1px solid #44475A", position: "sticky", left: 0, background: "#21222C", zIndex: 5, whiteSpace: "nowrap", color: "#F8F8F2" };
  const extraCellStyle = { width: COL_W, minWidth: COL_W, padding: "8px 6px", textAlign: "center", borderRight: "1px solid #44475A", fontSize: "0.9rem" };
  const subCellStyle = { width: COL_W, minWidth: COL_W, padding: "8px 6px", textAlign: "center", borderRight: "1px solid #44475A", fontSize: "0.9rem", color: "#F8F8F2" };

  async function handleEditSave(form) {
    if (!editEntry) return;
    setSavingEdit(true);
    try {
      // 1) Lançamento real (DAS/LP): atualiza a entry. INSS sintético não tem lançamento — pula.
      // Propaga exceção para o modal exibir o erro inline (handleUpdateEntry engole via try/catch;
      // por isso validamos o retorno: se vier { ok:false } do backend, lança).
      if (!editEntry.synthetic && onUpdateEntry) {
        const result = await onUpdateEntry(editEntry.id, form);
        if (result && result.ok === false) {
          throw new Error(result.error || result.message || "Falha ao salvar lançamento.");
        }
      }
      // 2) Acréscimo (juros/multa; e o principal, no caso do INSS) → acrescimos da circular.
      if (Array.isArray(form.acrescimoTributos) && onSaveCircular) {
        const comp = editEntry.competencia;
        const merged = { ...(circularData?.acrescimos?.[comp] || {}) };
        for (const t of form.acrescimoTributos) {
          const existing = merged[t.key] || {};
          merged[t.key] = {
            // principal só é editado no modo INSS; nos demais, preserva o existente.
            principal: t.principal !== undefined ? numOrNull(t.principal) : (existing.principal ?? null),
            juros: numOrNull(t.juros),
            multa: numOrNull(t.multa),
          };
        }
        await onSaveCircular({ competencia: comp, acrescimos: merged });
      }
      await onLoad(year, competencia);
      setEditEntry(null);
    } finally {
      setSavingEdit(false);
    }
  }

  // Frente B: acréscimo (juros/multa) agregado por célula subtipo×mês.
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const numOrNull = (s) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? r2(v) : 0; };
  function acrescimoFor(colKey, comp) {
    const keys = SUBTIPO_TO_ACRESCIMO[colKey];
    if (!keys) return null;
    const src = circularData?.acrescimos?.[comp];
    if (!src) return null;
    let principal = 0, juros = 0, multa = 0;
    for (const k of keys) {
      const t = src[k];
      if (t) { principal += Number(t.principal) || 0; juros += Number(t.juros) || 0; multa += Number(t.multa) || 0; }
    }
    // Ignora acréscimo "vazio" (tudo zero) — evita célula-fantasma "R$ 0,00" e badge sem valor.
    if (r2(principal) <= 0 && r2(juros) <= 0 && r2(multa) <= 0) return null;
    return { principal: r2(principal), juros: r2(juros), multa: r2(multa), acrescimo: r2(juros + multa) };
  }
  async function handleCancelBaixa(baixaId) {
    if (!onCancelBaixa) return;
    setCancellingBaixaId(baixaId);
    try {
      await onCancelBaixa(baixaId);
      await onLoad(year, competencia);
    } finally {
      setCancellingBaixaId(null);
    }
  }

  return (
    <div style={{ padding: "var(--space-3) var(--space-4)", width: "100%", background: "#1A1B26", minHeight: "100%" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700, color: "#F8F8F2" }}>Circular</h2>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <button
            onClick={() => onYearChange(year - 1)}
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              width: 28, height: 28, cursor: "pointer", fontSize: "0.875rem",
            }}
          >
            ←
          </button>
          <span style={{ fontWeight: 700, fontSize: "1rem", minWidth: 48, textAlign: "center", color: "#F8F8F2" }}>{year}</span>
          <button
            onClick={() => onYearChange(year + 1)}
            disabled={year >= currentYear + 1}
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              width: 28, height: 28, cursor: year >= currentYear + 1 ? "default" : "pointer",
              fontSize: "0.875rem", opacity: year >= currentYear + 1 ? 0.4 : 1,
            }}
          >
            →
          </button>
          <button
            onClick={() => onLoad(year)}
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              height: 28, padding: "0 10px", cursor: "pointer", fontSize: "0.8125rem",
            }}
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* Feedback */}
      {(error || message) && (
        <div style={{ marginBottom: 12, display: "grid", gap: 6 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 6, background: "#3d1515", border: "1px solid #7f1d1d", color: "#fca5a5", fontSize: "0.8125rem" }}>
              {error}
            </div>
          )}
          {message && (
            <div style={{ padding: "10px 14px", borderRadius: 6, background: "#0d2d1e", border: "1px solid #166534", color: "#86efac", fontSize: "0.8125rem" }}>
              {message}
            </div>
          )}
        </div>
      )}

      {/* Operações Fiscais removidas: ações (Buscar Guias, Verificar Pagtos, Sincronizar INSS)
          ficam nas abas Guias/Configurações; Circular foca só na tabela. */}

      {loading && (
        <p style={{ color: "#6272A4", textAlign: "center", padding: 32 }}>Carregando...</p>
      )}

      {!loading && !circularData && (
        <p style={{ color: "#6272A4", textAlign: "center", padding: 32 }}>
          Nenhum dado disponível. Clique em Atualizar.
        </p>
      )}

      {!loading && circularData && (
        <div style={{ overflowX: "auto", border: "1px solid #44475A", borderRadius: 6, background: "#21222C" }}>
          <table style={{ width: (1 + visibleRows.length + 2) * COL_W, minWidth: "100%", borderCollapse: "collapse", tableLayout: "fixed", color: "#F8F8F2" }}>
            <thead>
              <tr style={{ background: "#282A36" }}>
                <th style={headStickyStyle}>Mês</th>
                {visibleRows.map((col) => (
                  <th key={col.key} style={headCellStyle}>{col.label}</th>
                ))}
                <th style={{ ...headCellStyle, color: "#8BE9FD" }}>Faturamento</th>
                <th style={{ ...headCellStyle, color: "#FF4757" }}>Total em aberto</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={3 + visibleRows.length} style={{ padding: 24, textAlign: "center", color: "#aeb6d3", fontStyle: "italic" }}>
                    Nenhuma provisão registrada para {year}.
                  </td>
                </tr>
              )}
              {monthKeys.flatMap((comp, i) => {
                const fat = circularData.receitas?.[comp];
                const aberto = abertoByMonth[comp];
                const rows = [(
                  <tr key={comp}>
                    <td style={monthStickyStyle}>{MONTH_LABELS[i]}/{yy}</td>
                    {visibleRows.map((col) => (
                      <PagamentoCell
                        key={col.key}
                        entry={matrix[`${col.key}__${comp}`]}
                        onBaixa={(entry) => setBaixaEntry(entry)}
                        onEdit={(onUpdateEntry || onSaveCircular) ? (entry) => setEditEntry(entry) : null}
                        onCancelBaixa={onCancelBaixa ? handleCancelBaixa : null}
                        parcelamentosAtivos={parcelamentosAtivos}
                        onVincular={parcelamentos?.vincularEntry ? handleVincular : null}
                        onDesvincular={handleDesvincular}
                        acrescimo={acrescimoFor(col.key, comp)}
                      />
                    ))}
                    <td style={extraCellStyle}>{fat ? <span style={{ color: "#8BE9FD", fontWeight: 700 }}>R$ {fmtMoney(fat)}</span> : <span style={{ color: "#44475A" }}>—</span>}</td>
                    <td style={extraCellStyle}>{aberto ? <span style={{ color: "#FF4757", fontWeight: 700 }}>R$ {fmtMoney(aberto)}</span> : <span style={{ color: "#44475A" }}>—</span>}</td>
                  </tr>
                )];
                if ((i + 1) % 3 === 0) {
                  const qi = Math.floor(i / 3);
                  const triStyle = { ...subCellStyle, fontWeight: 700, borderTop: "2px solid #44475A", borderBottom: "2px solid #44475A" };
                  rows.push(
                    <tr key={`q${qi}`} style={{ background: "#282A36" }}>
                      <td style={{ ...monthStickyStyle, background: "#282A36", color: "#aeb6d3", fontWeight: 700, borderTop: "2px solid #44475A", borderBottom: "2px solid #44475A" }}>{qi + 1}º Trimestre</td>
                      {visibleRows.map((col) => { const v = sumQuarter(col.key, qi); return <td key={col.key} style={{ ...triStyle, color: "#aeb6d3" }}>{v ? `R$ ${fmtMoney(v)}` : "—"}</td>; })}
                      {(() => { const v = sumQuarter("__FAT__", qi); return <td style={{ ...triStyle, color: "#8BE9FD" }}>{v ? `R$ ${fmtMoney(v)}` : "—"}</td>; })()}
                      {(() => { const v = sumQuarter("__ABERTO__", qi); return <td style={{ ...triStyle, color: "#FF4757" }}>{v ? `R$ ${fmtMoney(v)}` : "—"}</td>; })()}
                    </tr>
                  );
                }
                return rows;
              })}
              {/* Anual */}
              <tr style={{ background: "#1f2030", borderTop: "3px solid #44475A" }}>
                <td style={{ ...monthStickyStyle, background: "#1f2030", fontWeight: 800 }}>Anual</td>
                {visibleRows.map((col) => { const v = sumYear(col.key); return <td key={col.key} style={{ ...subCellStyle, fontWeight: 800 }}>{v ? `R$ ${fmtMoney(v)}` : "—"}</td>; })}
                {(() => { const v = sumYear("__FAT__"); return <td style={{ ...subCellStyle, fontWeight: 800, color: "#8BE9FD" }}>{v ? `R$ ${fmtMoney(v)}` : "—"}</td>; })()}
                {(() => { const v = sumYear("__ABERTO__"); return <td style={{ ...subCellStyle, fontWeight: 800, color: "#FF4757" }}>{v ? `R$ ${fmtMoney(v)}` : "—"}</td>; })()}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Parcelamentos foram movidos pra aba própria "Parcelamento" (grupo Contabilidade). */}

      {/* Baixa Modal */}
      {baixaEntry && (
        <BaixaModal
          entry={baixaEntry}
          accounts={accounts}
          saving={savingBaixa}
          onSave={async (input) => {
            await onCreateBaixa(baixaEntry.id, input);
            await onLoad(year, competencia);
            setBaixaEntry(null);
          }}
          onClose={() => setBaixaEntry(null)}
          onLoadBaixaTemplate={onLoadBaixaTemplate}
        />
      )}

      {/* Entry Edit Modal — inclui juros/multa (e valor, p/ INSS sintético) na mesma tela. */}
      {editEntry && (
        <CircularEntryEditModal
          entry={editEntry}
          accounts={accounts || []}
          saving={savingEdit}
          onSave={handleEditSave}
          onClose={() => setEditEntry(null)}
          onSearchHistoricos={onSearchHistoricos}
          acrescimosComp={circularData?.acrescimos?.[editEntry.competencia] || {}}
        />
      )}
    </div>
  );
}

