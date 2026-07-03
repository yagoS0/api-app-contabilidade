// Q12.B.5: painel manual de captura DFe (NF-e via SEFAZ).
// Sem worker — usuário aperta botão e o backend roda síncrono (loop NSU até esgotar).

import { useState } from "react";
import { PANEL, fmtDate, syncStaleness, StalenessBadge } from "./notasStyles";

function ResultBlock({ result }) {
  if (!result) return null;
  const t = result.byType || {};
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
            NF-e completas: <strong style={{ color: PANEL.text }}>{t.nfe_full || 0}</strong> ·{" "}
            Resumos: <strong style={{ color: PANEL.text }}>{t.nfe_summary || 0}</strong> ·{" "}
            Eventos: <strong style={{ color: PANEL.text }}>{t.event || 0}</strong> ·{" "}
            Pendências: <strong style={{ color: "#FFB347" }}>{t.pendencias || 0}</strong>
          </div>
          <div style={{ marginTop: 4, color: PANEL.muted, fontSize: "0.75rem" }}>
            Cursor NSU: {result.newCursor} / max: {result.maxNSU} · cert via: {result.certVia || "—"}
          </div>
        </>
      )}
    </div>
  );
}

export function DfeCapturePanel({ dfeState, dfeSyncing, dfeLastResult, onSync, onClearError }) {
  const [env, setEnv] = useState("prod");

  const inBackoff = dfeState?.dfeBackoffUntil && new Date(dfeState.dfeBackoffUntil) > new Date();
  const hasError = Boolean(dfeState?.dfeLastError);
  // Q12.B+++.10: detecção de erros comuns pra mostrar banner com instrução clara
  const errMsg = String(dfeState?.dfeLastError || "") + " " + String(dfeLastResult?.message || "");
  const isCertMismatch = /CERT_CNPJ_MISMATCH|cStat=593/i.test(errMsg);
  const isConsumoIndevido = /CONSUMO_INDEVIDO|cStat=656|Consumo Indevido/i.test(errMsg);
  const isNoCompanyCert = /NO_COMPANY_CERT/i.test(errMsg);
  // Q12.B+++.7: alerta de cursor desatualizado
  const stale = syncStaleness(dfeState?.dfeLastSyncAt);

  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      {stale.level === "danger" && (
        <div style={{ marginBottom: 12, padding: 12, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757", borderRadius: 6, color: "#FF4757", fontSize: "0.85rem" }}>
          🔴 <strong>Cursor desatualizado há {stale.days} dias.</strong> A SEFAZ tem janela de
          90 dias — notas mais antigas se tornam irrecuperáveis. CNPJs sem consulta por
          60+ dias também perdem geração de NSU (NT 2014.002 v1.10). <strong>Rode uma captura
          agora</strong> ou ative o worker automático (DFE_NOTAS_WORKER_ENABLED=1).
        </div>
      )}
      {stale.level === "warn" && (
        <div style={{ marginBottom: 12, padding: 12, background: "rgba(255,179,71,0.08)", border: "1px solid #FFB347", borderRadius: 6, color: "#FFB347", fontSize: "0.85rem" }}>
          ⚠ <strong>Cursor não atualizado há {stale.days} dias.</strong> Recomendado rodar
          captura antes de 60 dias pra não perder notas (janela SEFAZ de 90 dias).
        </div>
      )}
      {isNoCompanyCert && (
        <div style={{ marginBottom: 12, padding: 12, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", borderRadius: 6, color: "#FFB347", fontSize: "0.85rem" }}>
          ⚠ <strong>Sem cert A1 cadastrado.</strong> A SEFAZ exige cert do próprio CNPJ pra
          DFe NF-e — não dá pra usar o cert do escritório. Vá em <strong>Editar Cadastro →
          🔐 Certificado A1 da empresa</strong> e faça upload.
        </div>
      )}
      {isCertMismatch && (
        <div style={{ marginBottom: 12, padding: 12, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757", borderRadius: 6, color: "#FF4757", fontSize: "0.85rem" }}>
          ⚠ <strong>Cert errado:</strong> o A1 cadastrado pertence a outro CNPJ. A SEFAZ rejeita
          se o cert não for da PRÓPRIA empresa. Vá em <strong>Editar Cadastro → 🔐 Certificado A1</strong>{" "}
          e suba o cert correto da empresa.
        </div>
      )}
      {isConsumoIndevido && (
        <div style={{ marginBottom: 12, padding: 12, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", borderRadius: 6, color: "#FFB347", fontSize: "0.85rem" }}>
          ⚠ <strong>Consumo Indevido:</strong> outra aplicação está consultando o mesmo CNPJ.
          A SEFAZ bloqueou por 1 hora. Verifique se a empresa tem outro sistema (Omie, Sage, etc)
          consultando NF-e em paralelo — só um agente é permitido por CNPJ.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text }}>
          📥 Captura DFe (NF-e via SEFAZ)
        </h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={env} onChange={(e) => setEnv(e.target.value)} disabled={dfeSyncing}
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "4px 8px", fontSize: "0.8rem" }}>
            <option value="prod">Produção</option>
            <option value="hom">Homologação</option>
          </select>
          {(hasError || inBackoff) && onClearError && (
            <button onClick={onClearError} disabled={dfeSyncing} title="Limpa backoff e último erro"
              style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.muted, cursor: "pointer", fontSize: "0.75rem" }}>
              Limpar erro
            </button>
          )}
          <button onClick={() => onSync({ env })} disabled={dfeSyncing || inBackoff}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none",
              background: inBackoff ? PANEL.border : "#8BE9FD",
              color: inBackoff ? PANEL.muted : "#000",
              cursor: (dfeSyncing || inBackoff) ? "not-allowed" : "pointer",
              fontSize: "0.85rem", fontWeight: 600,
            }}>
            {dfeSyncing ? "Capturando…" : "🔄 Buscar notas agora"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, fontSize: "0.8rem", color: PANEL.muted }}>
        <div>
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.5 }}>Cursor NSU</div>
          <div style={{ color: PANEL.text, fontFamily: "monospace" }}>{dfeState?.dfeNsuCursor || "0"}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.5 }}>Última sync</div>
          <div style={{ color: PANEL.text }}>
            {fmtDate(dfeState?.dfeLastSyncAt)}{" "}
            <span style={{ marginLeft: 4 }}><StalenessBadge lastSyncAt={dfeState?.dfeLastSyncAt} /></span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.5 }}>Último erro</div>
          <div style={{ color: dfeState?.dfeLastError ? "#FF4757" : PANEL.text, fontSize: "0.75rem" }}>
            {dfeState?.dfeLastError || "—"}
          </div>
        </div>
        {inBackoff && (
          <div>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.5 }}>Backoff até</div>
            <div style={{ color: "#FFB347" }}>{fmtDate(dfeState?.dfeBackoffUntil)}</div>
          </div>
        )}
      </div>

      <ResultBlock result={dfeLastResult} />
    </section>
  );
}
