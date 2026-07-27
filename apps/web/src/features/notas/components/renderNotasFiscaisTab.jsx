// Q12.C.1: aba "Notas Fiscais" da empresa — enxuta, em 2 janelas:
//   • Notas de serviço (NFS-e) — captura ADN + import XML
//   • Notas de venda (NF-e)    — captura SEFAZ; SÓ aparece se a empresa tem inscrição estadual.
// Competências/fechamento/apuração ficam na aba Apuração / página global.

import { useEffect, useState } from "react";
import { PANEL } from "./notasStyles";
import { DfeCapturePanel } from "./DfeCapturePanel";
import { AdnCapturePanel } from "./AdnCapturePanel";
import { NotasList } from "./NotasList";
import { NotasResumo } from "./NotasResumo";

function JanelaBtn({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        padding: "8px 16px", borderRadius: 999, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600,
        border: `1px solid ${active ? PANEL.accent : PANEL.border}`,
        background: active ? "rgba(189,147,249,0.15)" : "transparent",
        color: active ? PANEL.text : PANEL.muted,
      }}>
      {children}
    </button>
  );
}

export function NotasFiscaisTab({ notasPanel, hasInscricaoEstadual = false }) {
  const {
    loading, error, reload,
    dfeState, dfeSyncing, syncDfe, clearDfeError,
    adnState, adnSyncing, syncAdn, clearAdnError,
    notas, notasFilters, setNotasFilters, notasSummary,
    loadingNotas, loadNotas,
    importing, importNotas, marcarNotaStatus,
  } = notasPanel;

  // NFS-e é a janela padrão; NF-e só existe com inscrição estadual.
  const [janela, setJanela] = useState("NFSE");
  const janelaAtiva = (janela === "NFE" && !hasInscricaoEstadual) ? "NFSE" : janela;
  const notasDaJanela = notas.filter((n) => n.type === janelaAtiva);

  // O filtro `type` acompanha a janela ativa: assim o RESUMO (que é agregado no servidor)
  // fala da mesma janela que a tabela — e a paginação passa a ser por janela, não dividida
  // entre NF-e e NFS-e. Só dispara quando muda de fato (evita loop com o effect do hook).
  useEffect(() => {
    if (notasFilters.type !== janelaAtiva) {
      setNotasFilters({ ...notasFilters, type: janelaAtiva, offset: 0 });
    }
  }, [janelaAtiva, notasFilters, setNotasFilters]);

  function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // permite reimportar o mesmo arquivo
    if (files.length && importNotas) importNotas(files);
  }

  return (
    <div style={{ padding: 24, color: PANEL.text, maxWidth: 1400, margin: "0 auto" }}>
      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757", borderRadius: 6, color: "#FF4757" }}>
          {error}
          <button onClick={reload} style={{ marginLeft: 12, padding: "2px 8px", borderRadius: 4, border: "none", background: "#FF4757", color: "white", cursor: "pointer" }}>
            Tentar de novo
          </button>
        </div>
      )}

      {/* Toggle das duas janelas — NF-e só aparece com inscrição estadual. */}
      {hasInscricaoEstadual && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <JanelaBtn active={janelaAtiva === "NFSE"} onClick={() => setJanela("NFSE")}>Notas de serviço (NFS-e)</JanelaBtn>
          <JanelaBtn active={janelaAtiva === "NFE"} onClick={() => setJanela("NFE")}>Notas de venda (NF-e)</JanelaBtn>
        </div>
      )}

      {/* Barra de captura da janela ativa: consultar (+ importar XML só na de serviço). */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {janelaAtiva === "NFSE" ? (
          <>
            <AdnCapturePanel adnState={adnState} adnSyncing={adnSyncing} onSync={syncAdn} onClearError={clearAdnError} />
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 6,
              border: "none", background: importing ? "#555" : "#2E86DE", color: "white",
              cursor: importing ? "default" : "pointer", fontSize: "0.85rem", fontWeight: 600, opacity: importing ? 0.7 : 1,
            }}>
              {importing ? "Importando…" : "⬆️ Importar XML"}
              <input type="file" accept=".xml,text/xml,application/xml" multiple disabled={importing} onChange={onPickFiles} style={{ display: "none" }} />
            </label>
          </>
        ) : (
          <DfeCapturePanel dfeState={dfeState} dfeSyncing={dfeSyncing} onSync={syncDfe} onClearError={clearDfeError} />
        )}
      </div>

      <NotasResumo
        summary={notasSummary}
        janela={janelaAtiva}
        competencia={notasFilters.competencia}
        loading={loadingNotas}
        papel={notasFilters.papel}
        // Clicar na caixa filtra a tabela por papel. Clicar na já ativa NÃO desliga: a tabela
        // sempre mostra um dos dois lados (emitidas por padrão) — sem estado "misturado".
        onSelectPapel={(p) => {
          if (notasFilters.papel === p) return;
          setNotasFilters({ ...notasFilters, papel: p, offset: 0 });
        }}
      />

      <NotasList
        notas={notasDaJanela}
        total={notasDaJanela.length}
        filters={notasFilters}
        onFiltersChange={setNotasFilters}
        onApply={(f) => loadNotas(f)}
        loading={loadingNotas}
        onMarcarStatus={marcarNotaStatus}
      />

      {loading && notas.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: PANEL.muted }}>Carregando…</div>
      )}
    </div>
  );
}
