// Q12.B.5: captura manual de NF-e (SEFAZ DFe) — versão enxuta (só o botão de consultar).
// Sem worker — usuário aperta botão e o backend roda síncrono (loop NSU até esgotar).

import { useState } from "react";
import { PANEL } from "./notasStyles";

export function DfeCapturePanel({ dfeState, dfeSyncing, onSync, onClearError }) {
  const [env, setEnv] = useState("prod");
  const inBackoff = dfeState?.dfeBackoffUntil && new Date(dfeState.dfeBackoffUntil) > new Date();
  const hasError = Boolean(dfeState?.dfeLastError);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => onSync({ env })} disabled={dfeSyncing || inBackoff}
        style={{
          padding: "8px 14px", borderRadius: 6, border: "none",
          background: inBackoff ? PANEL.border : "#8BE9FD",
          color: inBackoff ? PANEL.muted : "#000",
          cursor: (dfeSyncing || inBackoff) ? "not-allowed" : "pointer",
          fontSize: "0.85rem", fontWeight: 600,
        }}>
        {dfeSyncing ? "Capturando…" : "🔄 Buscar NF-e"}
      </button>
      <select value={env} onChange={(e) => setEnv(e.target.value)} disabled={dfeSyncing}
        style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 8px", fontSize: "0.8rem" }}>
        <option value="prod">Produção</option>
        <option value="hom">Homologação</option>
      </select>
      {(hasError || inBackoff) && onClearError && (
        <button onClick={onClearError} disabled={dfeSyncing} title="Limpa backoff e último erro"
          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.muted, cursor: "pointer", fontSize: "0.75rem" }}>
          Limpar erro
        </button>
      )}
      {hasError && (
        <span style={{ color: "#FF4757", fontSize: "0.78rem" }} title={dfeState.dfeLastError}>
          {dfeState.dfeLastError}
        </span>
      )}
    </div>
  );
}
