// Q9: 4 modais coexistindo neste arquivo (escopo acoplado, padrão usado em Q6):
//   - ParcelamentoCreateModal: wizard pra criar parcelamento novo (templates + dados + preview)
//   - ParcelamentosList: tabela embedável na Circular (cabeçalhos expansíveis + parcelas)
//   - ParcelaPaymentModal: confirmar pagamento (só "juros do mês")
//   - GuideLinkParcelamentoModal: "esta guia é parcela? vincular existente ou criar novo"

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";

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
    if (!templatePaymentId) return setErr("Selecione um template de pagamento.");
    if (!numParcelas || numParcelas < 1) return setErr("Número de parcelas inválido.");
    if (!Number(principalPerParcela) || Number(principalPerParcela) <= 0) return setErr("Valor por parcela inválido.");
    if (!competenciaInicial) return setErr("Competência inicial obrigatória.");
    try {
      await onCreate({
        label: label.trim(), kind,
        templateOpeningFunctionId: templateOpeningId || null,
        templatePaymentFunctionId: templatePaymentId,
        templateRescisionFunctionId: templateRescisionId || null,
        numEntradas: Number(numEntradas) || 0,
        numParcelas: Number(numParcelas),
        principalPerParcela: Number(principalPerParcela),
        principalTotal: Number(principalTotal) || null,
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
        padding: 20, width: "100%", maxWidth: 760, maxHeight: "92vh", overflowY: "auto",
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
                Abertura
                <select value={templateOpeningId} onChange={(e) => setTemplateOpeningId(e.target.value)} style={FIELD_STYLE}>
                  <option value="">— sem abertura —</option>
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
              <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 8, fontSize: "0.75rem", color: PANEL.text }}>
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
export function ParcelamentosList({ parcelamentos, loading, onPayParcela, onRescindir, onOpenCreate }) {
  const [expandedIds, setExpandedIds] = useState(new Set());

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

  return (
    <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${PANEL.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ color: PANEL.text, fontSize: "0.9rem" }}>Parcelamentos ({parcelamentos.length})</strong>
        {onOpenCreate && <Button size="sm" variant="success" onClick={onOpenCreate}>+ Novo</Button>}
      </div>
      {parcelamentos.map((p) => {
        const isExpanded = expandedIds.has(p.id);
        const pagas = (p.parcelas || []).filter((pa) => pa.statusPagamento === "PAGO").length;
        const guidesByNum = new Map((p.guides || []).map((g) => [g.numeroParcela, g]));

        const statusColors = {
          ATIVO: "#69FF47",
          QUITADO: "#8BE9FD",
          RESCINDIDO: "#FF4757",
        };
        const statusColor = statusColors[p.status] || PANEL.muted;

        return (
          <div key={p.id} style={{ borderBottom: `1px solid ${PANEL.border}` }}>
            <div
              onClick={() => {
                const next = new Set(expandedIds);
                if (isExpanded) next.delete(p.id); else next.add(p.id);
                setExpandedIds(next);
              }}
              style={{
                padding: "10px 14px", cursor: "pointer", display: "grid",
                gridTemplateColumns: "20px 1fr auto", gap: 12, alignItems: "center",
                background: isExpanded ? PANEL.field : "transparent",
              }}
            >
              <span style={{ color: PANEL.muted, fontSize: "0.9rem" }}>{isExpanded ? "▼" : "▶"}</span>
              <div>
                <div style={{ color: PANEL.text, fontWeight: 700, fontSize: "0.85rem" }}>{p.label}</div>
                <div style={{ color: PANEL.muted, fontSize: "0.7rem", marginTop: 2 }}>
                  {p.kind} · R$ {fmtMoney(p.totalValue)} · {p.numParcelas} parcelas · {pagas} pagas
                  <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 999, background: `${statusColor}33`, color: statusColor, fontWeight: 700, fontSize: "0.65rem" }}>
                    {p.status}
                  </span>
                </div>
              </div>
              {p.status === "ATIVO" && onRescindir && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // eslint-disable-next-line no-alert
                    if (window.confirm(`Rescindir o parcelamento "${p.label}"? Esta ação gera um lançamento de rescisão e marca o parcelamento como RESCINDIDO.`)) {
                      onRescindir(p.id);
                    }
                  }}
                  style={{
                    fontSize: "0.7rem", padding: "4px 10px", cursor: "pointer",
                    background: "transparent", color: "#FF4757", border: "1px solid #FF4757", borderRadius: 4,
                  }}
                >
                  Rescindir
                </button>
              )}
            </div>

            {isExpanded && (
              <div style={{ padding: "8px 14px 14px 34px", background: PANEL.field }}>
                {p.aberturaEntry && (
                  <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginBottom: 6, fontStyle: "italic" }}>
                    Abertura em {new Date(p.aberturaEntry.data).toLocaleDateString("pt-BR")} —
                    Principal R$ {fmtMoney(p.principalTotal)} + Juros R$ {fmtMoney(p.jurosTotal)} = R$ {fmtMoney(p.totalValue)}
                  </div>
                )}
                <div style={{ display: "grid", gap: 2 }}>
                  {(p.parcelas || []).map((parc) => {
                    const num = parc.numeroParcela;
                    const linkedGuide = guidesByNum.get(num);
                    const hasGuide = Boolean(linkedGuide || parc.sourceGuideId);
                    const isPaid = parc.statusPagamento === "PAGO";
                    const isOpen = parc.statusPagamento === "ABERTO";
                    const isLive = hasGuide; // viva = tem guia subida
                    const baixaJuros = (parc.baixas || []).find((b) => /juros/i.test(b.historico));
                    const jurosPago = baixaJuros ? Number(baixaJuros.lines?.find((l) => l.tipo === "D")?.valor || 0) : 0;

                    return (
                      <div key={parc.id} style={{
                        display: "grid", gridTemplateColumns: "70px 90px 1fr 130px 110px",
                        gap: 8, alignItems: "center", padding: "4px 8px",
                        background: "transparent",
                        borderBottom: `1px solid ${PANEL.border}`,
                        opacity: !isLive && !isPaid ? 0.4 : 1,
                      }}>
                        <span style={{ color: PANEL.muted, fontSize: "0.75rem" }}>
                          {num <= (p.numEntradas || 0) ? `Entr ${num}` : `Parc ${String(num).padStart(2, "0")}`}
                        </span>
                        <span style={{ color: PANEL.text, fontSize: "0.75rem" }}>{parc.competencia}</span>
                        <span style={{ color: PANEL.text, fontSize: "0.75rem" }}>
                          R$ {fmtMoney(parc.lines?.[0]?.valor)}
                          {isPaid && jurosPago > 0 && (
                            <span style={{ color: PANEL.muted, marginLeft: 6, fontSize: "0.7rem" }}>
                              + R$ {fmtMoney(jurosPago)} juros
                            </span>
                          )}
                        </span>
                        <span>
                          {isPaid && <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: 999, background: "rgba(105,255,71,0.20)", color: "#69FF47", border: "1px solid #69FF47", fontWeight: 700 }}>PAGO</span>}
                          {!isPaid && isOpen && isLive && <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: 999, background: "rgba(255,71,87,0.20)", color: "#FF4757", border: "1px solid #FF4757", fontWeight: 700 }}>EM ABERTO</span>}
                          {!isPaid && !isLive && <span style={{ fontSize: "0.65rem", color: PANEL.muted, fontStyle: "italic" }}>aguardando guia</span>}
                        </span>
                        <span style={{ textAlign: "right" }}>
                          {!isPaid && isLive && onPayParcela && (
                            <button
                              onClick={() => onPayParcela(p, parc)}
                              style={{ fontSize: "0.7rem", padding: "3px 8px", cursor: "pointer", background: "#69FF47", color: "#1A1B26", border: "none", borderRadius: 3, fontWeight: 700 }}
                            >
                              Confirmar pagto
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ParcelaPaymentModal — confirmar pagamento (só campo juros)
// ─────────────────────────────────────────────────────────────────────────
export function ParcelaPaymentModal({ parcelamento, parcela, saving, onConfirm, onClose }) {
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
            <div style={{ fontSize: "0.7rem", color: "#69FF47", fontWeight: 700, marginBottom: 4 }}>PREVIEW</div>
            <div>D=553/principal → R$ {fmtMoney(principal)}</div>
            {juros > 0 && <div>D=501/juros → R$ {fmtMoney(juros)}</div>}
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
              <div style={{ color: PANEL.muted, fontSize: "0.7rem" }}>Continua o fluxo automático (gera provisão genérica via Q5).</div>
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
                      <span style={{ color: PANEL.muted, fontSize: "0.7rem" }}>(sugerido pela competência da guia, mas pode alterar)</span>
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
              <div style={{ color: PANEL.muted, fontSize: "0.7rem" }}>Abre o wizard de criação. A guia será linkada à parcela escolhida (default = 1 = entrada).</div>
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
