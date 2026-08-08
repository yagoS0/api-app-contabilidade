// Q12.B+: captura manual de NFS-e (ADN / Emissor Nacional) — versão enxuta (só o botão de consultar).

import { useState } from "react";
import { PANEL } from "./notasStyles";
import { Button } from "../../../components/ui/Button";

export function AdnCapturePanel({ adnState, adnSyncing, onSync, onClearError }) {
  const [env, setEnv] = useState("prod");
  const inBackoff = adnState?.adnBackoffUntil && new Date(adnState.adnBackoffUntil) > new Date();
  const hasError = Boolean(adnState?.adnLastError);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Button onClick={() => onSync({ env })} disabled={adnSyncing || inBackoff}>
        {adnSyncing ? "Capturando…" : "🔄 Buscar NFS-e"}
      </Button>
      <select value={env} onChange={(e) => setEnv(e.target.value)} disabled={adnSyncing}
        style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 8px", fontSize: "0.8rem" }}>
        <option value="prod">Produção</option>
        <option value="hom">Homologação</option>
      </select>
      {(hasError || inBackoff) && onClearError && (
        <button onClick={onClearError} disabled={adnSyncing} title="Limpa backoff e último erro"
          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.muted, cursor: "pointer", fontSize: "0.75rem" }}>
          Limpar erro
        </button>
      )}
      {hasError && (
        <span style={{ color: "#FF4757", fontSize: "0.78rem" }} title={adnState.adnLastError}>
          {adnState.adnLastError}
        </span>
      )}
    </div>
  );
}
