// Q12.B+: captura manual de NFS-e via ADN — mesmo padrão visual do DfeCapturePanel.

import { useState } from "react";
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

export function AdnCapturePanel({ adnState, adnSyncing, adnLastResult, onSync, onClearError }) {
  const [env, setEnv] = useState("prod");
  const inBackoff = adnState?.adnBackoffUntil && new Date(adnState.adnBackoffUntil) > new Date();
  const hasError = Boolean(adnState?.adnLastError);
  // Q12.B+++.4: detecta erro de falta de cert empresa pra dar guidance específica
  const errMsg = String(adnState?.adnLastError || "") + " " + String(adnLastResult?.message || "");
  const isNoCompanyCert = /NO_COMPANY_CERT/i.test(errMsg);
  const isCnpjNotInAdn = /CNPJ_NOT_IN_ADN/i.test(errMsg);

  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      {isNoCompanyCert && (
        <div style={{ marginBottom: 12, padding: 12, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", borderRadius: 6, color: "#FFB347", fontSize: "0.85rem" }}>
          ⚠ <strong>Esta empresa precisa ter A1 cadastrado pra capturar NFS-e nacional.</strong>{" "}
          Vá em <strong>Editar Cadastro → 🔐 Certificado A1 da empresa</strong> e faça upload do PFX.
        </div>
      )}
      {isCnpjNotInAdn && (
        <div style={{ marginBottom: 12, padding: 12, background: "rgba(139,233,253,0.08)", border: "1px solid #8BE9FD", borderRadius: 6, color: "#8BE9FD", fontSize: "0.85rem" }}>
          ℹ <strong>CNPJ não responde no ADN Nacional.</strong>{" "}
          Provável: município da empresa ainda não aderiu ao Padrão Nacional NFS-e
          (muitas cidades grandes só vão entrar até 2027). NF-e (SEFAZ) continua funcionando.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text }}>
          📥 Captura NFS-e (ADN / Emissor Nacional)
        </h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(hasError || inBackoff) && onClearError && (
            <button onClick={onClearError} disabled={adnSyncing} title="Limpa backoff e último erro"
              style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.muted, cursor: "pointer", fontSize: "0.75rem" }}>
              Limpar erro
            </button>
          )}
          <select value={env} onChange={(e) => setEnv(e.target.value)} disabled={adnSyncing}
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "4px 8px", fontSize: "0.8rem" }}>
            <option value="prod">Produção</option>
            <option value="hom">Homologação</option>
          </select>
          <button onClick={() => onSync({ env })} disabled={adnSyncing || inBackoff}
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
