// Q41: Aba "Situação Fiscal" (SITFIS) — mostra a última consulta gravada + botão para consultar no SERPRO.

import { Button } from "../../../../components/ui/Button";

const SITUACAO_META = {
  COM_PENDENCIA: { label: "Com pendência", color: "#FF4757", bg: "rgba(255,71,87,0.12)" },
  REGULAR: { label: "Regular", color: "#69FF47", bg: "rgba(105,255,71,0.10)" },
  PROCESSANDO: { label: "Processando", color: "#FFB347", bg: "rgba(255,179,71,0.12)" },
};

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function SituacaoBadge({ situacao }) {
  const meta = SITUACAO_META[situacao] || { label: "Sem consulta", color: "#A7B0C0", bg: "rgba(167,176,192,0.10)" };
  return (
    <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: "0.85rem", fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}` }}>
      {meta.label}
    </span>
  );
}

export function SitfisTab({ sitfisPanel }) {
  const { status, loading, consulting, error, notice, pdfUrl, consultar } = sitfisPanel || {};

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, color: "#F8F8F2" }}>Situação Fiscal</h2>
          <p style={{ margin: "4px 0 0", color: "#A7B0C0", fontSize: "0.9rem" }}>
            Relatório de situação fiscal (SITFIS) da empresa junto ao SERPRO / Receita Federal.
          </p>
        </div>
        <Button variant="success" disabled={consulting} onClick={consultar}>
          {consulting ? "Consultando…" : "Consultar situação fiscal agora"}
        </Button>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 6, background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", color: "#FF4757", fontSize: "0.9rem" }}>
          {error}
        </div>
      )}
      {notice && !error && (
        <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 6, background: "rgba(139,233,253,0.10)", border: "1px solid #8BE9FD", color: "#8BE9FD", fontSize: "0.9rem" }}>
          {notice}
        </div>
      )}

      <div style={{ marginTop: 20, padding: 20, borderRadius: 12, background: "#21222C", border: "1px solid #44475A" }}>
        {loading ? (
          <p style={{ color: "#A7B0C0", textAlign: "center", margin: 0 }}>Carregando…</p>
        ) : !status ? (
          <p style={{ color: "#A7B0C0", margin: 0 }}>
            Nenhuma consulta de situação fiscal foi feita ainda. Clique em “Consultar situação fiscal agora”.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>Situação</span>
                <SituacaoBadge situacao={status.situacao} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>Última consulta</span>
                <strong style={{ color: "#F8F8F2" }}>{formatDateTime(status.checkedAt)}</strong>
              </div>
            </div>

            {status.texto && (
              <div style={{ marginTop: 18 }}>
                <span style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>Relatório</span>
                <pre style={{ marginTop: 6, padding: 14, background: "#282A36", borderRadius: 8, color: "#F8F8F2", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 420, overflow: "auto", fontSize: "0.85rem" }}>
                  {status.texto}
                </pre>
              </div>
            )}
            {status.relatorioPdfFileId && (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>Relatório (PDF)</span>
                  {pdfUrl && (
                    <a
                      href={pdfUrl}
                      download={`situacao-fiscal.pdf`}
                      style={{ padding: "6px 12px", borderRadius: 6, background: "rgba(105,255,71,0.12)", border: "1px solid #69FF47", color: "#69FF47", fontSize: "0.82rem", fontWeight: 700, textDecoration: "none" }}
                    >
                      ⬇ Baixar PDF
                    </a>
                  )}
                </div>
                {pdfUrl ? (
                  <iframe
                    title="Relatório de situação fiscal (SITFIS)"
                    src={pdfUrl}
                    style={{ width: "100%", height: 600, border: "1px solid #44475A", borderRadius: 8, background: "#fff" }}
                  />
                ) : (
                  <p style={{ color: "#A7B0C0", margin: 0, fontSize: "0.85rem" }}>Carregando o PDF…</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
