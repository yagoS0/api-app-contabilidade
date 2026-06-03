// Q12.C.1: aba "Notas Fiscais" da empresa — listagem de NF-e/NFS-e + captura.
// Competências/fechamento/pendências MOVERAM-SE pra página global de Apuração.

import { PANEL } from "./notasStyles";
import { DfeCapturePanel } from "./DfeCapturePanel";
import { AdnCapturePanel } from "./AdnCapturePanel";
import { NotasList } from "./NotasList";

export function NotasFiscaisTab({ notasPanel }) {
  const {
    ano,
    loading, error, reload,
    dfeState, dfeSyncing, dfeLastResult, syncDfe, clearDfeError,
    adnState, adnSyncing, adnLastResult, syncAdn, clearAdnError,
    notas, notasTotal, notasSummary,
    notasFilters, setNotasFilters,
    loadingNotas, loadNotas,
  } = notasPanel;

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <DfeCapturePanel
          dfeState={dfeState} dfeSyncing={dfeSyncing} dfeLastResult={dfeLastResult}
          onSync={syncDfe} onClearError={clearDfeError}
        />
        <AdnCapturePanel
          adnState={adnState} adnSyncing={adnSyncing} adnLastResult={adnLastResult}
          onSync={syncAdn} onClearError={clearAdnError}
        />
      </div>

      <NotasList
        notas={notas}
        total={notasTotal}
        summary={notasSummary}
        ano={ano}
        filters={notasFilters}
        onFiltersChange={setNotasFilters}
        onApply={(f) => loadNotas(f)}
        loading={loadingNotas}
      />

      {loading && notas.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: PANEL.muted }}>Carregando…</div>
      )}

      <div style={{ marginTop: 16, padding: 12, background: PANEL.field, borderRadius: 6, fontSize: "0.8rem", color: PANEL.muted }}>
        💡 <strong style={{ color: PANEL.text }}>Apuração e fechamento</strong> agora ficam na página
        global "Apuração" (acessível na home), onde você vê todas as empresas juntas. Aqui você só
        navega/captura notas desta empresa.
      </div>
    </div>
  );
}
