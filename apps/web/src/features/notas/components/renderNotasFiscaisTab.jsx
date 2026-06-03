// Q12.A.4: componente raiz da aba "Notas Fiscais".
// Orquestra: ProcuracoesPanel + CompetenciasTable + CompetenciaDetailPanel + PendenciasList.

import { useState } from "react";
import { PANEL } from "./notasStyles";
import { ProcuracoesPanel } from "./ProcuracoesPanel";
import { CompetenciasTable } from "./CompetenciasTable";
import { CompetenciaDetailPanel } from "./CompetenciaDetailPanel";
import { PendenciasList } from "./PendenciasList";
import { ReabrirCompetenciaModal } from "./ReabrirCompetenciaModal";

export function NotasFiscaisTab({ notasPanel }) {
  const {
    ano, setAno,
    competencias, procuracoes, pendencias,
    loading, saving, error,
    reload,
    createProcuracao, revogarProcuracao,
    fecharCompetencia, reabrirCompetencia,
    resolverPendencia,
  } = notasPanel;

  const [selectedComp, setSelectedComp] = useState(null);
  const [reabrirComp, setReabrirComp] = useState(null);

  function handleDetalhar(comp) { setSelectedComp(comp.competencia); }

  const detail = selectedComp ? competencias.find((c) => c.competencia === selectedComp) : null;

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

      <ProcuracoesPanel
        procuracoes={procuracoes}
        saving={saving}
        onCreate={createProcuracao}
        onRevogar={revogarProcuracao}
      />

      <CompetenciasTable
        ano={ano} setAno={setAno}
        competencias={competencias}
        saving={saving || loading}
        onFechar={fecharCompetencia}
        onReabrir={(comp) => setReabrirComp(comp)}
        onDetalhar={handleDetalhar}
      />

      {detail && (
        <CompetenciaDetailPanel
          comp={detail}
          saving={saving}
          onFechar={fecharCompetencia}
          onReabrir={(comp) => setReabrirComp(comp)}
          onClose={() => setSelectedComp(null)}
        />
      )}

      <PendenciasList
        pendencias={pendencias}
        saving={saving}
        onReabrir={(comp) => setReabrirComp(comp)}
        onResolver={resolverPendencia}
      />

      {reabrirComp && (
        <ReabrirCompetenciaModal
          competencia={reabrirComp}
          saving={saving}
          onConfirm={async (reason) => { await reabrirCompetencia(reabrirComp, reason); }}
          onClose={() => setReabrirComp(null)}
        />
      )}

      {loading && competencias.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: PANEL.muted }}>Carregando…</div>
      )}
    </div>
  );
}
