// Q14.2.e — Form do Cadastro Fiscal (regime, CNAEs, sublimite).
import { useEffect, useState } from "react";
import { PANEL } from "../../notas/components/notasStyles";

const REGIMES = [
  { value: "SIMPLES_NACIONAL", label: "Simples Nacional" },
  { value: "LUCRO_PRESUMIDO", label: "Lucro Presumido" },
  { value: "LUCRO_REAL", label: "Lucro Real" },
  { value: "MEI", label: "MEI" },
];

export function CadastroFiscalForm({ cadastro, cnaePrincipalRef, saving, onSave }) {
  const [form, setForm] = useState({
    regime: "SIMPLES_NACIONAL",
    dataOpcaoSN: "",
    cnaePrincipal: "",
    cnaesSecundarios: "",
    sublimiteICMSISS: false,
    usaFatorR: false,
    forcarTipoReceitaPorCnae: false,
    observacoes: "",
  });

  useEffect(() => {
    if (cadastro) {
      setForm({
        regime: cadastro.regime || "SIMPLES_NACIONAL",
        dataOpcaoSN: cadastro.dataOpcaoSN ? new Date(cadastro.dataOpcaoSN).toISOString().slice(0, 10) : "",
        cnaePrincipal: cadastro.cnaePrincipal || "",
        cnaesSecundarios: (cadastro.cnaesSecundarios || []).join(", "),
        sublimiteICMSISS: !!cadastro.sublimiteICMSISS,
        usaFatorR: !!cadastro.usaFatorR,
        forcarTipoReceitaPorCnae: !!cadastro.forcarTipoReceitaPorCnae,
        observacoes: cadastro.observacoes || "",
      });
    }
  }, [cadastro]);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    await onSave({
      regime: form.regime,
      dataOpcaoSN: form.dataOpcaoSN || null,
      cnaePrincipal: form.cnaePrincipal.replace(/\D+/g, ""),
      cnaesSecundarios: form.cnaesSecundarios.split(",").map((c) => c.trim().replace(/\D+/g, "")).filter(Boolean),
      sublimiteICMSISS: form.sublimiteICMSISS,
      usaFatorR: form.usaFatorR,
      forcarTipoReceitaPorCnae: form.forcarTipoReceitaPorCnae,
      observacoes: form.observacoes.trim() || null,
    });
  }

  const inputStyle = {
    background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6,
    color: PANEL.text, padding: "8px 12px", fontSize: "0.9rem",
  };
  // Campos read-only (regime/CNAE vêm do cadastro da empresa).
  const readOnlyStyle = {
    background: PANEL.surface, border: `1px dashed ${PANEL.border}`, borderRadius: 6,
    color: PANEL.text, padding: "8px 12px", fontSize: "0.9rem",
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
      <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>Cadastro Fiscal</div>

      {/* Regime + CNAEs: read-only (fonte = cadastro da empresa). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem", color: PANEL.muted }}>
          Regime tributário (do cadastro)
          <div style={{ ...readOnlyStyle }}>{REGIMES.find((r) => r.value === form.regime)?.label || form.regime || "—"}</div>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Data de opção pelo SN
          <input type="date" value={form.dataOpcaoSN} onChange={(e) => setField("dataOpcaoSN", e.target.value)} style={inputStyle} />
        </label>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem", color: PANEL.muted }}>
        CNAE principal (do cadastro)
        <div style={{ ...readOnlyStyle, fontFamily: "monospace" }}>{form.cnaePrincipal || "—"}</div>
        {cnaePrincipalRef && (
          <span style={{ fontSize: "0.7rem", color: cnaePrincipalRef.ambiguo ? "#FFB347" : "#69FF47" }}>
            {cnaePrincipalRef.ambiguo ? "⚠ Ambíguo: " : "✓ "}{cnaePrincipalRef.descricao}
            {!cnaePrincipalRef.ambiguo && ` → sugestão: ${cnaePrincipalRef.tipoReceitaSugerido}`}
          </span>
        )}
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem", color: PANEL.muted }}>
        CNAEs secundários (do cadastro)
        <div style={{ ...readOnlyStyle, fontFamily: "monospace" }}>{form.cnaesSecundarios || "—"}</div>
      </label>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={form.sublimiteICMSISS} onChange={(e) => setField("sublimiteICMSISS", e.target.checked)} />
          Sublimite ICMS/ISS
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={form.usaFatorR} onChange={(e) => setField("usaFatorR", e.target.checked)} />
          Usa Fator R
        </label>
      </div>

      {/* Override CNAE — perigoso, com aviso visível */}
      <div style={{ padding: 12, background: form.forcarTipoReceitaPorCnae ? "rgba(255,71,87,0.10)" : PANEL.field, border: `1px solid ${form.forcarTipoReceitaPorCnae ? "#FF4757" : PANEL.border}`, borderRadius: 6, display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={form.forcarTipoReceitaPorCnae} onChange={(e) => setField("forcarTipoReceitaPorCnae", e.target.checked)} />
          <strong>Forçar tipo de receita pelo CNAE principal</strong>
        </label>
        {form.forcarTipoReceitaPorCnae && (
          <div style={{ fontSize: "0.75rem", color: "#FF4757" }}>
            ⚠ Classifica TODAS as notas pelo CNAE, ignorando o código da nota. Só pra empresa mono-atividade.
          </div>
        )}
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
        Observações
        <textarea value={form.observacoes} onChange={(e) => setField("observacoes", e.target.value)}
          rows={2} style={{ ...inputStyle, fontFamily: "inherit" }} />
      </label>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" disabled={saving}
          style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#BD93F9", color: "#000", cursor: "pointer", fontSize: "0.9rem", fontWeight: 600 }}>
          {saving ? "Salvando…" : "💾 Salvar cadastro"}
        </button>
      </div>
    </form>
  );
}
