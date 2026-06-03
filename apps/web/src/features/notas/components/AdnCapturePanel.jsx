// Q12.B+: captura manual de NFS-e via ADN — mesmo padrão visual do DfeCapturePanel.

import { PANEL, fmtDate } from "./notasStyles";

function ResultBlock({ result }) {
  if (!result) return null;
  const s = result.byStatus || {};
  return (
    <div style={{ marginTop: 12, padding: 10, background: PANEL.field, borderRadius: 6, fontSize: "0.8rem", color: PANEL.text }}>
      {result.ok === false ? (
        <span style={{ color: "#FF4757" }}>
          ✗ <strong>{result.reason || "Falha"}</strong> — {result.message || ""}
        </span>
      ) : (
        <>
          <strong>✓ Captura concluída</strong>{" "}
          <span style={{ color: PANEL.muted }}>
            ({result.iterations || 0} iteração(ões), {result.totalDocs || 0} doc(s))
          </span>
          <div style={{ marginTop: 4, color: PANEL.muted }}>
            Novas/atualizadas: <strong style={{ color: PANEL.text }}>{s.upserted || 0}</strong> ·{" "}
            Pendências: <strong style={{ color: "#FFB347" }}>{s.pendencia_criada || 0}</strong> ·{" "}
            Pulados: <strong style={{ color: PANEL.text }}>{s.skipped || 0}</strong>
          </div>
          <div style={{ marginTop: 4, color: PANEL.muted, fontSize: "0.75rem" }}>
            Cursor NSU: {result.newCursor} · cert via: {result.certVia || "—"}
          </div>
        </>
      )}
    </div>
  );
}

export function AdnCapturePanel({ adnState, adnSyncing, adnLastResult, onSync }) {
  const inBackoff = adnState?.adnBackoffUntil && new Date(adnState.adnBackoffUntil) > new Date();

  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text }}>
          📥 Captura NFS-e (ADN / Emissor Nacional)
        </h3>
        <button onClick={() => onSync()} disabled={adnSyncing || inBackoff}
          style={{
            padding: "6px 14px", borderRadius: 6, border: "none",
            background: inBackoff ? PANEL.border : "#BD93F9",
            color: inBackoff ? PANEL.muted : "#000",
            cursor: (adnSyncing || inBackoff) ? "not-allowed" : "pointer",
            fontSize: "0.85rem", fontWeight: 600,
          }}>
          {adnSyncing ? "Capturando…" : "🔄 Buscar NFS-e agora"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, fontSize: "0.8rem", color: PANEL.muted }}>
        <div>
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.5 }}>Cursor NSU (ADN)</div>
          <div style={{ color: PANEL.text, fontFamily: "monospace" }}>{adnState?.adnNsuCursor || "0"}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.5 }}>Última sync</div>
          <div style={{ color: PANEL.text }}>{fmtDate(adnState?.adnLastSyncAt)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.5 }}>Último erro</div>
          <div style={{ color: adnState?.adnLastError ? "#FF4757" : PANEL.text, fontSize: "0.75rem" }}>
            {adnState?.adnLastError || "—"}
          </div>
        </div>
        {inBackoff && (
          <div>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.5 }}>Backoff até</div>
            <div style={{ color: "#FFB347" }}>{fmtDate(adnState?.adnBackoffUntil)}</div>
          </div>
        )}
      </div>

      <ResultBlock result={adnLastResult} />

      <div style={{ marginTop: 12, padding: 10, background: "rgba(189,147,249,0.08)", borderLeft: "3px solid #BD93F9", borderRadius: 4, fontSize: "0.75rem", color: PANEL.muted }}>
        <strong style={{ color: "#BD93F9" }}>Como funciona:</strong> consulta o ADN/Emissor Nacional
        por NSU usando o cert do escritório (procuração e-CAC já registrada na Receita). Mesmo
        padrão da consulta ao SERPRO. Configure <code>ADN_BASE_URL</code>/<code>ADN_DFE_PATH</code> no env da API.
      </div>
    </section>
  );
}
