// Aba "Parcelamento" (grupo Contabilidade). Antes esta lista morava no rodapé da Circular;
// foi movida pra cá pra ter espaço próprio. A CRIAÇÃO de parcelamento continua vindo de
// Lançamentos/Guias (fluxo de ingestão da 1ª parcela) — aqui é a visão de gerenciar os que
// já existem: conferência de parcelas pagas, lista, config de contas e rescisão.
//
// Dados: hook useParcelamentos (accountingPanel.parcelamentos). Ele carrega sozinho no mount
// e recarrega após cada ação (rescindir/config/conferência), então não precisa de reload manual.

import { ParcelamentosList, ConferenciaParcelasPanel } from "../components/ParcelamentoModals";

const PANEL = { text: "#F8F8F2", muted: "#A7B0C0" };

export function ParcelamentoTab({ parcelamentos, accounts = [], onSearchHistoricos, onGetHistoricosByCode }) {
  if (!parcelamentos) {
    return <div style={{ padding: 24, color: PANEL.muted }}>Carregando…</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "1.15rem", color: PANEL.text }}>Parcelamentos</h1>
        <span style={{ fontSize: "0.85rem", color: PANEL.muted }}>
          Conferência de parcelas, contas de lançamento e rescisão. Novos parcelamentos entram pela guia (Lançamentos / Guias).
        </span>
      </div>

      <ConferenciaParcelasPanel
        listConferencia={parcelamentos.listConferencia}
        aprovarConferencia={parcelamentos.aprovarConferencia}
      />

      <ParcelamentosList
        parcelamentos={(parcelamentos.parcelamentos || []).filter((p) => p.status !== "RESCINDIDO")}
        loading={parcelamentos.loading}
        onRescindir={(parcId, body) => parcelamentos.rescindir(parcId, body)}
        getConfig={parcelamentos.getConfig}
        saveConfig={parcelamentos.saveConfig}
        accounts={accounts}
        onSearchHistoricos={onSearchHistoricos}
        onGetHistoricosByCode={onGetHistoricosByCode}
      />
    </div>
  );
}
