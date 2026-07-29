// Q41: Aba "Situação Fiscal" (SITFIS) — mostra a última consulta gravada + botão para consultar no SERPRO.


import { useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { SitfisRelatorioTabela } from "./SitfisRelatorioTabela";



// Rótulos das colunas na tela (as chaves vêm do parser, que segue a ordem das colunas do PDF).


// Resumo do relatório: campos rotulados + as tabelas de pendência.

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
  // O PDF é o documento oficial, mas a leitura do dia a dia é a tabela. Por isso ele é opcional,
  // sob clique — e não mais o único jeito de ver o relatório.
  const [verPdf, setVerPdf] = useState(false);
  const {
    status, loading, consulting, error, notice, pdfUrl, consultar,
    pdfIndisponivel, podeConsultar = true, proximaConsultaEm,
  } = sitfisPanel || {};



  // C11: abrir a aba NÃO consulta — mostra o relatório salvo. Consultar de novo só pelo botão,
  // e mesmo assim respeitando a janela de 4h (consulta paga; o limite do SERPRO é por contratante).
  const bloqueado = !podeConsultar && !consulting;
  const tituloBotao = bloqueado
    ? `Nova consulta liberada em ${formatDateTime(proximaConsultaEm)} (limite de 1 a cada 4h)`
    : "Consulta o SERPRO e salva o relatório";

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
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

            {(status.relatorio || status.relatorioPdfFileId) && (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>
                    Diagnóstico fiscal
                    {status.relatorio?.emitidoEm ? ` · emitido em ${status.relatorio.emitidoEm}` : ""}
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {status.relatorioPdfFileId && status.relatorio && (
                      <button
                        type="button"
                        onClick={() => setVerPdf((v) => !v)}
                        style={{ padding: "6px 12px", borderRadius: 6, background: "transparent", border: "1px solid #8BE9FD", color: "#8BE9FD", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}
                      >
                        {verPdf ? "Ocultar PDF" : "Ver PDF oficial"}
                      </button>
                    )}
                    {pdfUrl && (
                      <a
                        href={pdfUrl}
                        download="situacao-fiscal.pdf"
                        style={{ padding: "6px 12px", borderRadius: 6, background: "rgba(105,255,71,0.12)", border: "1px solid #69FF47", color: "#69FF47", fontSize: "0.82rem", fontWeight: 700, textDecoration: "none" }}
                      >
                        ⬇ Baixar PDF
                      </a>
                    )}
                  </div>
                </div>

                {/* TABELA primeiro — é a leitura do dia a dia. O PDF é o documento oficial e fica
                    opcional, sob clique. O parser ORGANIZA e não interpreta: não extrai valor
                    monetário nenhum. A versão anterior extraía, e mostrou "R$ 100,00" numa empresa
                    sem débito — era o 100,00% de participação societária. */}
                {status.relatorio ? (
                  <SitfisRelatorioTabela relatorio={status.relatorio} />
                ) : (
                  <p style={{ color: "#A7B0C0", margin: "0 0 10px", fontSize: "0.82rem" }}>
                    Relatório antigo, gravado antes de guardarmos o texto — só o PDF está disponível.
                  </p>
                )}

                {(verPdf || !status.relatorio) && (
                  pdfUrl ? (
                    <iframe
                      title="Relatório de situação fiscal (SITFIS)"
                      src={pdfUrl}
                      style={{ width: "100%", height: 700, border: "1px solid #44475A", borderRadius: 8, background: "#fff", marginTop: 12 }}
                    />
                  ) : pdfIndisponivel ? (
                    <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 8, background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", color: "#FFB347", fontSize: "0.85rem", lineHeight: 1.5 }}>
                      O PDF deste relatório não está mais no servidor (foi gravado antes do
                      armazenamento persistente).{status.relatorio ? " A tabela acima veio do texto salvo e segue válida" : " A situação e a data acima seguem válidas"} — clique em{" "}
                      <strong>“Consultar situação fiscal agora”</strong> para gerar o PDF novamente.
                    </div>
                  ) : (
                    <p style={{ color: "#A7B0C0", marginTop: 12, fontSize: "0.85rem" }}>Carregando o PDF…</p>
                  )
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
