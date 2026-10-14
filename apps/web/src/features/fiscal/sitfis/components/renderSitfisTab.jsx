// Q41: Aba "Situação Fiscal" (SITFIS) — mostra a última consulta gravada + botão para consultar no SERPRO.


import { useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";

import { PendenciasFiscaisTabelas } from "./PendenciasFiscaisTabelas";

import { RecalcularGuiasSitfis } from "./RecalcularGuiasSitfis";



// Rótulos das colunas na tela (as chaves vêm do parser, que segue a ordem das colunas do PDF).


// Resumo do relatório: campos rotulados + as tabelas de pendência.

const SITUACAO_META = {
  INCONCLUSIVO: { label: "Leitura inconclusiva", color: "var(--state-warn)", bg: "var(--state-warn-surface)" },
  COM_PENDENCIA: { label: "Com pendência", color: "var(--state-danger)", bg: "var(--state-danger-surface)" },
  EM_PARCELAMENTO: { label: "Em parcelamento", color: "var(--text)", bg: "var(--state-neutral-surface)" },
  REGULAR: { label: "Regular", color: "var(--text-muted)", bg: "var(--state-neutral-surface)" },
  PROCESSANDO: { label: "Processando", color: "var(--state-warn)", bg: "var(--state-warn-surface)" },
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
    <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: "0.85rem", fontWeight: 500, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}` }}>
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

          <Button disabled={consulting || bloqueado} onClick={consultar} title={tituloBotao}>{consulting ? "Consultando…" : "Consultar situação fiscal agora"}</Button>
        </div>
      </div>
      <p className="sitfis-meta sitfis-consultation-note">Consulta ao SERPRO com custo para o escritório · limite de uma a cada 4 horas.{bloqueado && <> Nova consulta em {formatDateTime(proximaConsultaEm)}.</>}</p>

      {error && (
        <div role="alert" className="sitfis-read-error">
          {error}
          <Button variant="secondary" onClick={reload}>Tentar ler o relatório salvo novamente</Button>
        </div>
      )}
      {notice && !error && (
        <div role="status" className="sitfis-notice">
          {notice}
        </div>
      )}

      <div className="sitfis-summary">
        {loading ? <span role="status">Carregando relatório salvo…</span> : !status && error ? null : !status ? (
          <span>Nenhuma consulta de situação fiscal foi feita ainda.</span>
        ) : <>
          <div className="sitfis-summary-item"><span>Situação no relatório federal</span><SituacaoBadge situacao={status.situacao} /></div>
          <div className="sitfis-summary-item"><span>Último relatório obtido</span><strong>{formatDateTime(status.ultimoRelatorioEm)}</strong></div>
          <details className="sitfis-report-meta"><summary>Datas da consulta</summary><p>Última tentativa: {formatDateTime(status.checkedAt)}</p>
          {status.relatorio?.emitidoEm && <p>Emitido em {status.relatorio.emitidoEm}</p>}</details>
        </>}
      </div>
      {(status?.relatorioPdfFileId || pdfUrl) && <div className="sitfis-document-actions" aria-label="Documento oficial salvo">
        <span>Documento oficial salvo</span>
          {status?.relatorioPdfFileId && <Button size="sm" variant="secondary" onClick={() => setVerPdf(v => !v)}>{verPdf ? "Ocultar PDF" : "Ver PDF oficial"}</Button>}
          {pdfUrl && <a className="btn btn-secondary btn-sm" href={pdfUrl} download="situacao-fiscal.pdf">Baixar PDF oficial</a>}
      </div>}
      {status?.relatorioPdfFileId && !status.relatorio && <p className="sitfis-meta">Relatório antigo, gravado antes de guardarmos o texto — só o PDF está disponível.</p>}
      {verPdf && (pdfUrl ? (
        <iframe title="Relatório de situação fiscal (SITFIS)" src={pdfUrl} style={{ width: "100%", height: "70vh", minHeight: 300, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", marginTop: 12 }} />
      ) : pdfIndisponivel ? (
        <div role="alert" className="sitfis-pdf-error">
          Não foi possível carregar o PDF salvo.
          <Button size="sm" variant="secondary" onClick={recarregarPdf}>Tentar carregar PDF novamente</Button>
          <span>Esta tentativa lê o arquivo salvo e não faz uma nova consulta ao SERPRO.</span>
        </div>
      ) : <p role="status" className="sitfis-meta">Carregando o PDF…</p>)}
      <PendenciasFiscaisTabelas podeEditar={["ACCOUNTANT", "FIRM_ADMIN"].includes(String(empresa?.myRole || "").toUpperCase())} key={`${companyId || ""}:${status?.ultimoRelatorioEm || ""}:${JSON.stringify(status?.relatorio)}`} relatorio={status?.relatorio} manuais={sitfisPanel?.manuais} contabeis={sitfisPanel?.contabeis} empresa={empresa} />

      {guidesPanel && <div ref={areaRecalculo}><RecalcularGuiasSitfis guidesPanel={guidesPanel} feedback={feedback} /></div>}
    </div>
  );
}
