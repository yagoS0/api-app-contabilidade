// Q41: Aba "Situação Fiscal" (SITFIS) — mostra a última consulta gravada + botão para consultar no SERPRO.

import { useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { parseSitfisTexto, temResumo } from "../lib/parseSitfisTexto";

function diasAte(dataBR) {
  const m = String(dataBR || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const alvo = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Math.ceil((alvo.getTime() - Date.now()) / 86400000);
}

const fmtMoney = (v) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");

// Rótulos das colunas na tela (as chaves vêm do parser, que segue a ordem das colunas do PDF).
const COLUNA_LABEL = {
  receita: "Receita", periodo: "Período", vencimento: "Vencimento",
  valorOriginal: "Vl. original", saldoDevedor: "Saldo devedor", multa: "Multa", juros: "Juros",
  saldoConsolidado: "Saldo consolidado", situacao: "Situação",
  processo: "Processo", localizacao: "Localização",
  inscricao: "Inscrição", inscritoEm: "Inscrito em", ajuizadoEm: "Ajuizado em", tipoDevedor: "Tipo de devedor",
};
const MONETARIAS = new Set(["valorOriginal", "saldoDevedor", "multa", "juros", "saldoConsolidado"]);
const NIVEL_COR = { pendencia: "#FF4757", suspenso: "#FFB347" };

function TabelaSecao({ tabela }) {
  const cor = NIVEL_COR[tabela.nivel] || "#A7B0C0";
  const th = { padding: "6px 8px", textAlign: "left", fontSize: "0.68rem", color: "#A7B0C0", fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" };
  const td = { padding: "6px 8px", fontSize: "0.8rem", color: "#F8F8F2", whiteSpace: "nowrap" };
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: cor }} />
        <strong style={{ color: cor, fontSize: "0.85rem" }}>{tabela.titulo}</strong>
        <span style={{ color: "#6272A4", fontSize: "0.75rem" }}>({tabela.registros.length})</span>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid #44475A", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#282A36" }}>
              {tabela.colunas.map((c) => (
                <th key={c} style={{ ...th, textAlign: MONETARIAS.has(c) ? "right" : "left" }}>
                  {COLUNA_LABEL[c] || c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabela.registros.map((r, idx) => (
              <tr key={idx} style={{ borderTop: "1px solid #2b2d45" }}>
                {tabela.colunas.map((c) => (
                  <td
                    key={c}
                    style={{
                      ...td,
                      textAlign: MONETARIAS.has(c) ? "right" : "left",
                      fontFamily: MONETARIAS.has(c) ? "monospace" : undefined,
                      color: c === "situacao" ? cor : td.color,
                      fontWeight: c === "situacao" || c === "saldoConsolidado" ? 600 : undefined,
                    }}
                  >
                    {MONETARIAS.has(c) ? fmtMoney(r[c]) : (r[c] || "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Resumo do relatório: campos rotulados + as tabelas de pendência.
function ResumoRelatorio({ resumo }) {
  const dias = diasAte(resumo.certidaoValidade);
  const vencida = dias != null && dias < 0;
  const corValidade = vencida ? "#FF4757" : (dias != null && dias <= 30 ? "#FFB347" : "#69FF47");
  const item = { display: "flex", flexDirection: "column", gap: 2 };
  const rotulo = { color: "#A7B0C0", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em" };

  return (
    <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
      {[["Receita Federal", resumo.diagnosticoRfb], ["PGFN", resumo.diagnosticoPgfn]]
        .filter(([, frase]) => frase)
        .map(([orgao, frase]) => {
          const limpo = /n[ãa]o\s+foram\s+detectad|nada\s+consta/i.test(frase);
          return (
            <div key={orgao} style={{
              padding: "8px 12px", borderRadius: 8, fontSize: "0.82rem", lineHeight: 1.45,
              background: limpo ? "rgba(105,255,71,0.08)" : "rgba(255,71,87,0.08)",
              border: `1px solid ${limpo ? "#69FF47" : "#FF4757"}`,
              color: limpo ? "#69FF47" : "#FF4757",
            }}>
              <strong>{orgao}:</strong> {frase}
            </div>
          );
        })}
      {(resumo.totalDevido > 0 || resumo.parcelasEmAtraso > 0) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {resumo.totalDevido > 0 && (
            <span style={{ padding: "5px 12px", borderRadius: 999, background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", color: "#FF4757", fontSize: "0.85rem", fontWeight: 700 }}>
              Total em aberto: {fmtMoney(resumo.totalDevido)}
            </span>
          )}
          {resumo.parcelasEmAtraso > 0 && (
            <span style={{ padding: "5px 12px", borderRadius: 999, background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", color: "#FFB347", fontSize: "0.85rem", fontWeight: 700 }}>
              {resumo.parcelasEmAtraso} parcela(s) em atraso
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {resumo.situacaoCadastral && (
          <div style={item}>
            <span style={rotulo}>Situação cadastral</span>
            <strong style={{ color: "#F8F8F2" }}>{resumo.situacaoCadastral}</strong>
          </div>
        )}
        {resumo.certidaoTipo && (
          <div style={item}>
            <span style={rotulo}>Certidão</span>
            <strong style={{ color: "#F8F8F2" }}>{resumo.certidaoTipo}</strong>
            {resumo.certidaoCodigo && (
              <span style={{ color: "#6272A4", fontSize: "0.72rem", fontFamily: "monospace" }}>{resumo.certidaoCodigo}</span>
            )}
          </div>
        )}
        {resumo.certidaoEmissao && (
          <div style={item}>
            <span style={rotulo}>Emissão</span>
            <strong style={{ color: "#F8F8F2" }}>{resumo.certidaoEmissao}</strong>
          </div>
        )}
        {resumo.certidaoValidade && (
          <div style={item}>
            <span style={rotulo}>Validade</span>
            <strong style={{ color: corValidade }}>{resumo.certidaoValidade}</strong>
            {dias != null && (
              <span style={{ color: corValidade, fontSize: "0.72rem" }}>
                {vencida ? `vencida há ${Math.abs(dias)} dia(s)` : `faltam ${dias} dia(s)`}
              </span>
            )}
          </div>
        )}
      </div>

      {(resumo.tabelas || []).map((t) => <TabelaSecao key={t.id} tabela={t} />)}
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


  const resumo = useMemo(() => parseSitfisTexto(status?.texto), [status?.texto]);
  // PDF é OPCIONAL: a tabela é a visão padrão e o PDF abre por botão.
  const [verPdf, setVerPdf] = useState(false);

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

            {(status.relatorioPdfFileId || status.texto) && (
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>Relatório</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {pdfUrl && (
                      <button
                        type="button"
                        onClick={() => setVerPdf((v) => !v)}
                        style={{ padding: "6px 12px", borderRadius: 6, background: verPdf ? "rgba(139,233,253,0.18)" : "transparent", border: "1px solid #8BE9FD", color: "#8BE9FD", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}
                      >
                        {verPdf ? "Ver tabela" : "📄 Visualizar PDF"}
                      </button>
                    )}
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
                </div>
                {/* Tabela é o padrão; o PDF abre pelo botão. Sem texto salvo (nada a tabelar),
                    cai direto no PDF pra não ficar tela vazia. */}
                {pdfUrl && (verPdf || !status.texto) ? (
                  <iframe
                    title="Relatório de situação fiscal (SITFIS)"
                    src={pdfUrl}
                    style={{ width: "100%", height: 600, border: "1px solid #44475A", borderRadius: 8, background: "#fff" }}
                  />
                ) : status.texto ? (
                  // PDF indisponível (perdido antes do volume persistente), mas o TEXTO
                  // extraído está salvo no banco — mostra o relatório a partir dele.
                  <>
                    {pdfIndisponivel && (
                      <div style={{ padding: "8px 12px", marginBottom: 8, borderRadius: 6, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", color: "#FFB347", fontSize: "0.8rem" }}>
                        O PDF deste relatório não está mais no servidor — abaixo está o conteúdo dele.
                        Uma nova consulta gera o PDF de novo.
                      </div>
                    )}

                    {/* Resumo dos campos ROTULADOS (diagnóstico, certidão, validade). Débitos NÃO
                        são tabelados — o PDF é uma tabela e remontá-la a partir do texto gerou
                        valor falso antes. O relatório integral fica logo abaixo. */}
                    {temResumo(resumo) && <ResumoRelatorio resumo={resumo} />}

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
