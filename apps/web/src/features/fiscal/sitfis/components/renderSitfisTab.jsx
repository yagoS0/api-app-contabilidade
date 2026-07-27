// Q41: Aba "Situação Fiscal" (SITFIS) — mostra a última consulta gravada + botão para consultar no SERPRO.

import { useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { parseSitfisTexto, totalPendencias } from "../lib/parseSitfisTexto";

const fmtMoney = (v) => (Number.isFinite(v)
  ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  : "—");

const NIVEL_COR = { pendencia: "#FF4757", parcelamento: "#8BE9FD", info: "#A7B0C0" };

// Tabela das pendências extraídas do relatório. O texto completo continua acessível — o parse é
// best-effort e não pode esconder nada do relatório oficial.
function PendenciasTable({ itens }) {
  const th = { padding: "6px 8px", textAlign: "left", fontSize: "0.7rem", color: "#A7B0C0", fontWeight: 700, textTransform: "uppercase" };
  const td = { padding: "6px 8px", fontSize: "0.82rem", color: "#F8F8F2", verticalAlign: "top" };
  return (
    <div style={{ overflowX: "auto", border: "1px solid #44475A", borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#282A36" }}>
            <th style={th}>Origem</th>
            <th style={th}>Tipo</th>
            <th style={th}>Código</th>
            <th style={th}>Período</th>
            <th style={{ ...th, textAlign: "right" }}>Valor</th>
            <th style={th}>Situação</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i, idx) => (
            <tr key={idx} style={{ borderTop: "1px solid #2b2d45" }}>
              <td style={{ ...td, color: "#A7B0C0", whiteSpace: "nowrap" }}>{i.orgao || "—"}</td>
              <td style={{ ...td, color: NIVEL_COR[i.nivel] || "#F8F8F2" }}>{i.secao}</td>
              <td style={{ ...td, fontFamily: "monospace", whiteSpace: "nowrap" }}>{i.codigo || "—"}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{i.periodo || "—"}</td>
              <td style={{ ...td, textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                {i.valor != null ? fmtMoney(i.valor) : "—"}
              </td>
              <td style={{ ...td, color: NIVEL_COR[i.nivel] || "#F8F8F2", fontWeight: 600, whiteSpace: "nowrap" }}>
                {i.situacao || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SITUACAO_META = {
  COM_PENDENCIA: { label: "Com pendência", color: "#FF4757", bg: "rgba(255,71,87,0.12)" },
  EM_PARCELAMENTO: { label: "Em parcelamento", color: "#8BE9FD", bg: "rgba(139,233,253,0.12)" },
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
  const {
    status, loading, consulting, error, notice, pdfUrl, consultar,
    pdfIndisponivel, podeConsultar = true, proximaConsultaEm,
  } = sitfisPanel || {};

  const [verTexto, setVerTexto] = useState(false);
  const itens = useMemo(() => parseSitfisTexto(status?.texto), [status?.texto]);
  const totalDevido = useMemo(() => totalPendencias(itens), [itens]);

  // C11: abrir a aba NÃO consulta — mostra o relatório salvo. Consultar de novo só pelo botão,
  // e mesmo assim respeitando a janela de 4h (consulta paga; o limite do SERPRO é por contratante).
  const bloqueado = !podeConsultar && !consulting;
  const tituloBotao = bloqueado
    ? `Nova consulta liberada em ${formatDateTime(proximaConsultaEm)} (limite de 1 a cada 4h)`
    : "Consulta o SERPRO e salva o relatório";

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, color: "#F8F8F2" }}>Situação Fiscal</h2>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <Button variant="success" disabled={consulting || bloqueado} onClick={consultar} title={tituloBotao}>
            {consulting ? "Consultando…" : "Consultar situação fiscal agora"}
          </Button>
          {bloqueado && (
            <span style={{ color: "#A7B0C0", fontSize: "0.75rem" }}>
              Nova consulta em {formatDateTime(proximaConsultaEm)}
            </span>
          )}
        </div>
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

            {(status.relatorioPdfFileId || status.texto) && (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>Relatório</span>
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
                ) : status.texto ? (
                  // PDF indisponível (perdido antes do volume persistente) mas o TEXTO extraído
                  // está salvo — em vez do texto cru, mostra as pendências em tabela.
                  <>
                    {pdfIndisponivel && (
                      <div style={{ padding: "8px 12px", marginBottom: 8, borderRadius: 6, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", color: "#FFB347", fontSize: "0.8rem" }}>
                        O PDF deste relatório não está mais no servidor — abaixo está o conteúdo dele.
                        Uma nova consulta gera o PDF de novo.
                      </div>
                    )}

                    {itens.length > 0 && (
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                        <span style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>
                          {itens.length} item(ns) no relatório
                        </span>
                        {totalDevido > 0 && (
                          <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", color: "#FF4757", fontSize: "0.82rem", fontWeight: 700 }}>
                            Total em pendência: {fmtMoney(totalDevido)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setVerTexto((v) => !v)}
                          style={{ marginLeft: "auto", background: "transparent", border: "1px solid #44475A", color: "#A7B0C0", borderRadius: 6, padding: "4px 10px", fontSize: "0.78rem", cursor: "pointer" }}
                        >
                          {verTexto ? "Ver resumo" : "Ver relatório completo"}
                        </button>
                      </div>
                    )}

                    {itens.length > 0 && !verTexto ? (
                      <PendenciasTable itens={itens} />
                    ) : (
                      // Sem itens reconhecidos (ou a pedido) → o relatório inteiro, sem esconder nada.
                      <pre
                        style={{
                          margin: 0, padding: 14, maxHeight: 600, overflowY: "auto", overflowX: "auto",
                          background: "#1A1B26", border: "1px solid #44475A", borderRadius: 8,
                          color: "#F8F8F2", fontSize: "0.78rem", lineHeight: 1.5,
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                        }}
                      >
                        {status.texto}
                      </pre>
                    )}
                  </>
                ) : pdfIndisponivel ? (
                  <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", color: "#FFB347", fontSize: "0.85rem" }}>
                    O arquivo deste relatório não está mais no armazenamento do servidor. A situação
                    fiscal e a data acima seguem válidas — para ver o PDF de novo, consulte novamente.
                  </div>
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
