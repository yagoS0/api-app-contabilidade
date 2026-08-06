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
import { EmitirNfseWizard } from "./EmitirNfseWizard";
import { createApiClient } from "../../../api/client";

// Cliente próprio, mesmo padrão auto-contido do SITFIS e do Apuração v2 — a aba já recebe tudo
// por props e não tem `api` em escopo.
const nfseApi = createApiClient();

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

export function NotasFiscaisTab({ notasPanel, hasInscricaoEstadual = false, competencia: competenciaGlobal }) {
  const {
    loading, error, reload,
    dfeState, dfeSyncing, syncDfe, clearDfeError,
    adnState, adnSyncing, syncAdn, clearAdnError,
    companyId,
    notas, notasFilters, setNotasFilters, notasSummary,
    loadingNotas, loadNotas,
    importing, importNotas, marcarNotaStatus,
  } = notasPanel;

  // NFS-e é a janela padrão; NF-e só existe com inscrição estadual.
  const [janela, setJanela] = useState("NFSE");
  const [emitindo, setEmitindo] = useState(false);
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

  // A competência da EMPRESA (seletor do header) manda no filtro. Mesmo padrão do effect acima:
  // só escreve quando muda de fato, senão vira laço com o effect de carga do hook.
  useEffect(() => {
    if (competenciaGlobal && notasFilters.competencia !== competenciaGlobal) {
      setNotasFilters({ ...notasFilters, competencia: competenciaGlobal, offset: 0 });
    }
  }, [competenciaGlobal, notasFilters, setNotasFilters]);

  function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // permite reimportar o mesmo arquivo
    if (files.length && importNotas) importNotas(files);
  }

  return (
    /* Largura de trabalho (~90%). A tabela de notas tem número, chave, tomador, valor, data,
       status e ações — era a que mais truncava em 1400px. */
    <div style={{ padding: "24px 0", color: PANEL.text, width: "var(--content-wide)", margin: "0 auto" }}>
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

      {/* ⚠ EMITIR é o PRIMÁRIO da janela de NFS-e; buscar e importar viram secundários.
          A aba nasceu só para CAPTURAR nota que já existe, e emitir — que é o que a empresa faz
          para faturar — não tinha porta nenhuma na tela, embora o backend (`POST /nfse/issue`)
          esteja de pé há tempos. Só na janela de NFS-e: NF-e de venda não se emite por aqui. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {janelaAtiva === "NFSE" ? (
          <>
            <button
              type="button"
              onClick={() => setEmitindo(true)}
              style={{
                padding: "8px 16px", borderRadius: 6, border: "none",
                background: "var(--accent-cyan)", color: "#0b0b12",
                fontSize: "0.85rem", fontWeight: 700, cursor: "pointer",
              }}
            >
              + Emitir nota
            </button>
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
        verCanceladas={notasFilters.incluirCanceladas === "1"}
        // Alterna entre esconder (default, só faturamento) e mostrar as canceladas na tabela.
        onToggleCanceladas={() => setNotasFilters({
          ...notasFilters,
          incluirCanceladas: notasFilters.incluirCanceladas === "1" ? "" : "1",
          offset: 0,
        })}
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

      {emitindo && (
        <EmitirNfseWizard
          companyId={companyId}
          onEmitir={(payload) => nfseApi.emitirNfse(payload)}
          onClose={() => setEmitindo(false)}
          /* A nota recém-emitida precisa APARECER na lista — senão o contador emite, fecha o
             assistente e não vê nada mudar, e a dúvida "será que saiu?" leva a emitir de novo. */
          onEmitida={() => { reload?.(); loadNotas?.(notasFilters); }}
        />
      )}
    </div>
  );
}
