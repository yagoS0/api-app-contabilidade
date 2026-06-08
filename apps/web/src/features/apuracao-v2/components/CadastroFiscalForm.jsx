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

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
      <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>📋 Cadastro Fiscal</div>
      <div style={{ fontSize: "0.85rem", color: PANEL.muted }}>
        Define a "autoridade" pra classificação. Sem cadastro completo, o motor não consegue apurar.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Regime tributário *
          <select value={form.regime} onChange={(e) => setField("regime", e.target.value)} required style={inputStyle}>
            {REGIMES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Data de opção pelo SN
          <input type="date" value={form.dataOpcaoSN} onChange={(e) => setField("dataOpcaoSN", e.target.value)} style={inputStyle} />
        </label>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
        CNAE principal * (7 dígitos, sem hífen)
        <input type="text" value={form.cnaePrincipal} onChange={(e) => setField("cnaePrincipal", e.target.value)}
          placeholder="ex: 6201500" required maxLength={9} style={inputStyle} />
        {cnaePrincipalRef && (
          <span style={{ fontSize: "0.7rem", color: cnaePrincipalRef.ambiguo ? "#FFB347" : "#69FF47" }}>
            {cnaePrincipalRef.ambiguo ? "⚠ Ambíguo: " : "✓ "}{cnaePrincipalRef.descricao}
            {!cnaePrincipalRef.ambiguo && ` → sugestão: ${cnaePrincipalRef.tipoReceitaSugerido}`}
          </span>
        )}
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
        CNAEs secundários (separados por vírgula)
        <input type="text" value={form.cnaesSecundarios} onChange={(e) => setField("cnaesSecundarios", e.target.value)}
          placeholder="ex: 6202300, 6209100" style={inputStyle} />
      </label>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={form.sublimiteICMSISS} onChange={(e) => setField("sublimiteICMSISS", e.target.checked)} />
          Sublimite ICMS/ISS (R$ 3,6 mi por fora)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={form.usaFatorR} onChange={(e) => setField("usaFatorR", e.target.checked)} />
          Usa Fator R (tem serviços intelectuais)
        </label>
      </div>

      {/* Override CNAE — perigoso, com aviso visível */}
      <div style={{ padding: 12, background: form.forcarTipoReceitaPorCnae ? "rgba(255,71,87,0.10)" : PANEL.field, border: `1px solid ${form.forcarTipoReceitaPorCnae ? "#FF4757" : PANEL.border}`, borderRadius: 6, display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={form.forcarTipoReceitaPorCnae} onChange={(e) => setField("forcarTipoReceitaPorCnae", e.target.checked)} />
          <strong>Forçar tipo de receita pelo CNAE principal (override total)</strong>
        </label>
        <div style={{ fontSize: "0.75rem", color: form.forcarTipoReceitaPorCnae ? "#FF4757" : PANEL.muted }}>
          {form.forcarTipoReceitaPorCnae
            ? "⚠ ATIVO — TODAS as notas serão classificadas pelo TipoReceita do CNAE acima, ignorando o código LC116/cTribNac da nota. Use só pra empresas mono-atividade onde emissores mandam código errado."
            : "Quando ligado, ignora o código da nota e usa só o CNAE principal pra classificar tudo. Útil pra empresas mono-atividade."}
        </div>
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
