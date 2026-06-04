// Q12.C.2: página global de Apuração.
// Tabela com todas as empresas × competência selecionada.
// Permite fechar/reabrir competência por empresa direto da tabela.

import { useState } from "react";
import { AppShell } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Button } from "../../../components/ui/Button";
import { PANEL, StateBadge, fmtMoney, fmtDate, syncStaleness, StalenessBadge } from "../../notas/components/notasStyles";
import { ReabrirCompetenciaModal } from "../../notas/components/ReabrirCompetenciaModal";

function CompanyRow({ item, acting, onFechar, onReabrir, onOpenNotas }) {
  const canFechar = item.estado === "aberto" || item.estado === "em_conferencia";
  const canReabrir = ["fechado","calculado","revisado","transmitido","confirmado","erro"].includes(item.estado);

  return (
    <tr style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
      <td style={td}>
        <a onClick={onOpenNotas} style={{ color: PANEL.accent, cursor: "pointer", fontWeight: 500 }}>
          {item.razao}
        </a>
        <div style={{ fontSize: "0.7rem", color: PANEL.muted, fontFamily: "monospace" }}>{item.cnpj}</div>
      </td>
      <td style={td}>{item.regime || "—"}</td>
      <td style={td}><StateBadge estado={item.estado} /></td>
      <td style={{ ...td, textAlign: "right" }}>
        {item.totalNotas}
        {item.totalNotas > 0 && (
          <div style={{ fontSize: "0.7rem", color: PANEL.muted }}>
            NF-e {item.nfeCount} · NFS-e {item.nfseCount}
          </div>
        )}
      </td>
      <td style={{ ...td, textAlign: "right", fontFamily: "monospace", color: "#69FF47" }}>{fmtMoney(item.receitaEmitida)}</td>
      <td style={{ ...td, textAlign: "right", fontFamily: "monospace", color: "#8BE9FD" }}>{fmtMoney(item.comprasRecebidas)}</td>
      <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{fmtMoney(item.rb12)}</td>
      <td style={{ ...td, textAlign: "right" }}>{item.fatorR != null ? `${(Number(item.fatorR) * 100).toFixed(2)}%` : "—"}</td>
      <td style={{ ...td, textAlign: "right", color: item.pendenciasAbertas > 0 ? "#FF4757" : PANEL.muted }}>
        {item.pendenciasAbertas > 0 ? `⚠ ${item.pendenciasAbertas}` : "—"}
      </td>
      <td style={{ ...td, fontSize: "0.7rem" }}>
        <div title="Última captura NF-e (SEFAZ DFe)">
          <span style={{ color: PANEL.muted }}>NF-e:</span>{" "}
          <StalenessBadge lastSyncAt={item.dfeLastSyncAt} />
        </div>
        <div title="Última captura NFS-e (ADN)">
          <span style={{ color: PANEL.muted }}>NFS-e:</span>{" "}
          <StalenessBadge lastSyncAt={item.adnLastSyncAt} />
        </div>
      </td>
      <td style={{ ...td, textAlign: "right" }}>
        {canFechar && (
          <button onClick={onFechar} disabled={acting}
            style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#8BE9FD", color: "#000", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, marginRight: 4 }}>
            🔒 Fechar
          </button>
        )}
        {canReabrir && (
          <button onClick={onReabrir} disabled={acting}
            style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#FFB347", color: "#000", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
            🔓 Reabrir
          </button>
        )}
      </td>
    </tr>
  );
}
const td = { padding: 8 };

export function ApuracaoPage({ apuracaoPanel, onBack, onOpenCompanyNotas }) {
  const { competencia, setCompetencia, search, setSearch, items, loading, error, actingId, fechar, reabrir, reload } = apuracaoPanel;
  const [reabrindo, setReabrindo] = useState(null); // { portalClientId, razao }

  const totals = items.reduce((acc, i) => {
    acc.notas += i.totalNotas;
    acc.receita += i.receitaEmitida;
    acc.compras += i.comprasRecebidas;
    return acc;
  }, { notas: 0, receita: 0, compras: 0 });

  return (
    <AppShell>
      <PageHeader
        title="Apuração"
        description="Visão consolidada de todas as empresas para a competência selecionada — feche/reabra direto da tabela."
        actions={<Button variant="secondary" onClick={onBack}>Voltar</Button>}
      />

      <section className="panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: PANEL.muted, fontSize: "0.85rem" }}>
            Competência:
            <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
              style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px" }} />
          </label>
          <input type="text" placeholder="Filtrar por nome ou CNPJ" value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px", flex: 1, minWidth: 220 }} />
          <Button variant="secondary" onClick={reload} disabled={loading}>
            {loading ? "..." : "Atualizar"}
          </Button>
          <span style={{ marginLeft: "auto", color: PANEL.muted, fontSize: "0.85rem" }}>
            {items.length} empresa(s)
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
          <Box label="Total notas" value={totals.notas} accent={PANEL.text} />
          <Box label="Receita emitida (consolidada)" value={fmtMoney(totals.receita)} accent="#69FF47" />
          <Box label="Compras recebidas (consolidadas)" value={fmtMoney(totals.compras)} accent="#8BE9FD" />
        </div>

        {error && (
          <div style={{ padding: 12, marginBottom: 12, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757", borderRadius: 6, color: "#FF4757" }}>
            {error}
          </div>
        )}

        <div style={{ overflowX: "auto", background: PANEL.surface, borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
                <th style={td}>Empresa</th>
                <th style={td}>Regime</th>
                <th style={td}>Estado</th>
                <th style={{ ...td, textAlign: "right" }}>Notas</th>
                <th style={{ ...td, textAlign: "right" }}>Receita</th>
                <th style={{ ...td, textAlign: "right" }}>Compras</th>
                <th style={{ ...td, textAlign: "right" }}>RB12</th>
                <th style={{ ...td, textAlign: "right" }}>Fator R</th>
                <th style={{ ...td, textAlign: "right" }}>Pend</th>
                <th style={td}>Sync</th>
                <th style={{ ...td, textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <CompanyRow key={it.portalClientId}
                  item={it}
                  acting={actingId === it.portalClientId}
                  onFechar={() => fechar(it.portalClientId)}
                  onReabrir={() => setReabrindo({ id: it.portalClientId, razao: it.razao })}
                  onOpenNotas={() => onOpenCompanyNotas?.(it.portalClientId)}
                />
              ))}
              {items.length === 0 && !loading && (
                <tr><td colSpan={11} style={{ ...td, textAlign: "center", color: PANEL.muted, padding: 24 }}>
                  Nenhuma empresa encontrada.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reabrindo && (
        <ReabrirCompetenciaModal
          competencia={`${competencia} (${reabrindo.razao})`}
          saving={actingId === reabrindo.id}
          onConfirm={async (reason) => { await reabrir(reabrindo.id, reason); }}
          onClose={() => setReabrindo(null)}
        />
      )}
    </AppShell>
  );
}

function Box({ label, value, accent }) {
  return (
    <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: "1.15rem", fontWeight: 600, color: accent }}>{value}</div>
    </div>
  );
}
