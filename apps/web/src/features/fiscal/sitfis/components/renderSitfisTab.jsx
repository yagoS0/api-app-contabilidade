// Q41: Aba "Situação Fiscal" (SITFIS) — mostra a última consulta gravada + botão para consultar no SERPRO.


import { useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";

import { PendenciasFiscaisTabelas } from "./PendenciasFiscaisTabelas";

import { RecalcularGuiasSitfis } from "./RecalcularGuiasSitfis";



// Rótulos das colunas na tela (as chaves vêm do parser, que segue a ordem das colunas do PDF).


// Resumo do relatório: campos rotulados + as tabelas de pendência.

const SITUACAO_META = {
  INCONCLUSIVO: { label: "Leitura inconclusiva", color: "#FFB347", bg: "rgba(255,179,71,0.12)" },
  COM_PENDENCIA: { label: "Com pendência", color: "var(--danger)", bg: "rgba(255,71,87,0.12)" },
  EM_PARCELAMENTO: { label: "Em parcelamento", color: "#8BE9FD", bg: "rgba(139,233,253,0.12)" },
  REGULAR: { label: "Regular", color: "var(--success)", bg: "rgba(105,255,71,0.10)" },
  PROCESSANDO: { label: "Processando", color: "#FFB347", bg: "rgba(255,179,71,0.12)" },
};

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function SituacaoBadge({ situacao }) {
  const meta = SITUACAO_META[situacao] || { label: situacao ? `Situação não reconhecida: ${situacao}` : "Situação não informada", color: "var(--text-muted)", bg: "var(--state-neutral-surface)" };
  return (
    <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: "0.85rem", fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}` }}>
      {meta.label}
    </span>
  );
}

export function SitfisTab({ sitfisPanel, guidesPanel, feedback, companyId, empresa }) {

  // O PDF é o documento oficial, mas a leitura do dia a dia é a tabela. Por isso ele é opcional,
  // sob clique — e não mais o único jeito de ver o relatório.
  const [verPdf, setVerPdf] = useState(false);
  const areaRecalculo = useRef(null);
  function abrirRecalculo() {
    const detalhes = areaRecalculo.current?.querySelector("details");
    if (detalhes) detalhes.open = true;
    areaRecalculo.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    detalhes?.querySelector("summary")?.focus();
  }
  const {
    status, loading, consulting, error, notice, pdfUrl, consultar,
    pdfIndisponivel, podeConsultar = true, proximaConsultaEm, reload, recarregarPdf,
  } = sitfisPanel || {};



  // C11: abrir a aba NÃO consulta — mostra o relatório salvo. Consultar de novo só pelo botão,
  // e mesmo assim respeitando a janela de 4h (consulta paga; o limite do SERPRO é por contratante).
  const bloqueado = !podeConsultar && !consulting;
  const tituloBotao = bloqueado
    ? `Nova consulta liberada em ${formatDateTime(proximaConsultaEm)} (limite de 1 a cada 4h)`
    : "Consulta o SERPRO e salva o relatório";

  return (
    // ⚠ SEM LARGURA PRÓPRIA. Ela vinha daqui (`maxWidth: 1400`) e brigava com as outras abas da
    // empresa; agora quem a decide é o `largura` do `CompanyTabLayout`, que é onde ela é comparável
    // com a das irmãs. ⚠ O padding também sai: o primitivo já o aplica, e somar os dois dava 24px
    // dentro de `var(--space-5)`.
    <div>
      <div className="sitfis-heading">
        <h2>Situação Fiscal</h2>
        <div className="sitfis-actions">
          {guidesPanel && <Button size="sm" variant="secondary" onClick={abrirRecalculo}>Recalcular guia</Button>}
          {status?.relatorioPdfFileId && <Button size="sm" variant="secondary" onClick={() => setVerPdf(v => !v)}>{verPdf ? "Ocultar PDF" : "Ver PDF oficial"}</Button>}
          {pdfUrl && <a className="btn btn-secondary btn-sm" href={pdfUrl} download="situacao-fiscal.pdf">Baixar PDF oficial</a>}
          <Button size="sm" disabled={consulting || bloqueado} onClick={consultar} title={tituloBotao}>{consulting ? "Consultando…" : "Consultar situação fiscal agora"}</Button>
        </div>
      </div>
      {bloqueado && <p className="sitfis-meta">Nova consulta em {formatDateTime(proximaConsultaEm)}</p>}

      {error && (
        <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 6, background: "rgba(255,71,87,0.12)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.9rem" }}>
          {error}
          <Button variant="secondary" onClick={reload}>Tentar ler o relatório salvo novamente</Button>
        </div>
      )}
      {notice && !error && (
        <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 6, background: "rgba(139,233,253,0.10)", border: "1px solid #8BE9FD", color: "#8BE9FD", fontSize: "0.9rem" }}>
          {notice}
        </div>
      )}

      <div className="sitfis-summary">
        {loading ? <span>Carregando…</span> : !status && error ? null : !status ? (
          <span>Nenhuma consulta de situação fiscal foi feita ainda.</span>
        ) : <>
          <div className="sitfis-summary-item"><span>Situação no relatório federal</span><SituacaoBadge situacao={status.situacao} /></div>
          <div className="sitfis-summary-item"><span>Último relatório obtido</span><strong>{formatDateTime(status.ultimoRelatorioEm)}</strong></div>
          <span className="sitfis-meta">Última tentativa: {formatDateTime(status.checkedAt)}</span>
          {status.relatorio?.emitidoEm && <span className="sitfis-meta">Emitido em {status.relatorio.emitidoEm}</span>}
        </>}
      </div>
      {status?.relatorioPdfFileId && !status.relatorio && <p className="sitfis-meta">Relatório antigo, gravado antes de guardarmos o texto — só o PDF está disponível.</p>}
      {verPdf && (pdfUrl ? (
        <iframe title="Relatório de situação fiscal (SITFIS)" src={pdfUrl} style={{ width: "100%", height: "70vh", minHeight: 300, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", marginTop: 12 }} />
      ) : pdfIndisponivel ? (
        <div role="alert" className="sitfis-pdf-error">
          Não foi possível carregar o PDF salvo.
          <Button size="sm" variant="secondary" onClick={recarregarPdf}>Tentar carregar PDF novamente</Button>
          <span>Esta tentativa lê o arquivo salvo e não faz uma nova consulta ao SERPRO.</span>
        </div>
      ) : <p className="sitfis-meta">Carregando o PDF…</p>)}
      <PendenciasFiscaisTabelas key={`${companyId || ""}:${status?.ultimoRelatorioEm || ""}:${JSON.stringify(status?.relatorio)}`} relatorio={status?.relatorio} manuais={sitfisPanel?.manuais} contabeis={sitfisPanel?.contabeis} empresa={empresa} />

      {guidesPanel && <div ref={areaRecalculo}><RecalcularGuiasSitfis guidesPanel={guidesPanel} feedback={feedback} /></div>}
    </div>
  );
}
