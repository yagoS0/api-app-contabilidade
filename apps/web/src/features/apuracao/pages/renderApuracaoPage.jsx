// Q15.7: página global de Apuração (fluxo novo). Agora é SELECT-ONLY:
// tabela de empresas × competência; seleção múltipla das FECHADAS → [Apurar em lote].
// Fechar/transmitir/retificar saíram daqui — agora é dentro de cada empresa (aba Apuração).

import { AppShell } from "../../../components/layout/AppShell";
// C4: cabeçalho padronizado — PageShell põe o "← Voltar" no topo-esquerdo, igual às demais
// páginas de firma (PageHeader deixava o Voltar como botão solto à direita).
import { PageShell } from "../../../components/layout/PageShell";
import { Button } from "../../../components/ui/Button";
import { Feedback } from "../../../components/ui/Feedback";
import { PANEL, fmtMoney } from "../../notas/components/notasStyles";
import { BatchProgressModal } from "../components/BatchProgressModal";

const ESTADO_BADGE = {
  aberta:        { c: PANEL.muted,             s: "transparent",                 l: "aberta" },
  configurando:  { c: "var(--accent-cyan)",    s: "rgba(139, 233, 253, 0.13)",   l: "configurando" },
  calculada:     { c: "var(--accent-purple)",  s: "var(--accent-purple-surface)", l: "calculada" },
  fechada:       { c: "var(--state-warn)",     s: "var(--state-warn-surface)",   l: "fechada" },
  transmitida:   { c: "var(--state-ok)",       s: "var(--state-ok-surface)",     l: "transmitida" },
  confirmada:    { c: "var(--state-ok)",       s: "var(--state-ok-surface)",     l: "confirmada" },
  erro:          { c: "var(--state-danger)",   s: "var(--state-danger-surface)", l: "erro" },
  erro_calculo:  { c: "var(--state-danger)",   s: "var(--state-danger-surface)", l: "erro cálculo" },
  erro_transmissao: { c: "var(--state-danger)", s: "var(--state-danger-surface)", l: "erro transm." },
};

function EstadoBadge({ estado }) {
  const e = ESTADO_BADGE[estado] || ESTADO_BADGE.aberta;
  return (
    /* ⚠⚠ O FUNDO VEM DO PAR `-surface`, NUNCA DE `${e.c}22`. A concatenação de hex é o truque que
       este projeto já nomeou em cinco arquivos: ela **quebra em silêncio** no instante em que a cor
       vira `var(--…)`, porque `var(--state-ok)22` não é cor nenhuma — o fundo some e ninguém vê.
       Era literalmente o que travava este badge no hex literal. ⚠ `aberta` é `transparent` de
       propósito: `PANEL.muted` não tem par de superfície, e inventar um seria escolher uma cor. */
    <span style={{ padding: "2px 9px", borderRadius: 11, background: e.s, color: e.c, border: `1px solid ${e.c}`, fontSize: "0.72rem", fontWeight: 600 }}>
      {e.l}
    </span>
  );
}

const td = { padding: 8 };

export function ApuracaoPage({ apuracaoPanel, apuracaoApi, feedback, onBack, onOpenCompanyNotas }) {
  const {
    competencia, setCompetencia, search, setSearch, items, loading, error,
    selected, toggleSelect, selectAllFechadas, batchJobId, setBatchJobId, apurarEmLote, reload,
  } = apuracaoPanel;

  const fechadasCount = items.filter((i) => i.estado === "fechada").length;
  // Q52: "selecionar todas" marca só as empresas selecionáveis (estado "fechada").
  const allFechadasSelected = fechadasCount > 0 && selected.size === fechadasCount;
  const someFechadasSelected = selected.size > 0 && selected.size < fechadasCount;

  return (
    <PageShell
      title="Apuração"
      subtitle="Selecione as empresas fechadas e apure em lote. O fechamento é feito dentro de cada empresa (aba Apuração)."
      onBack={onBack}
    >
      <AppShell>
      <section className="panel" style={{ padding: 16 }}>
        {/* Filtros */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: PANEL.muted, fontSize: "0.85rem" }}>
            Competência:
            <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
              style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px" }} />
          </label>
          <input type="text" placeholder="Filtrar por nome ou CNPJ" value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px", flex: 1, minWidth: 220 }} />
          <Button variant="secondary" onClick={reload} disabled={loading}>{loading ? "..." : "Atualizar"}</Button>
        </div>

        {/* Barra de ações em lote */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: 10, background: PANEL.field, borderRadius: 8 }}>
          <button onClick={selectAllFechadas} disabled={fechadasCount === 0}
            style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.text, borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: "0.8rem" }}>
            {selected.size === fechadasCount && fechadasCount > 0 ? "Desmarcar todas" : "Selecionar fechadas"}
          </button>
          <span style={{ color: PANEL.muted, fontSize: "0.82rem" }}>
            {selected.size} selecionada(s) · {fechadasCount} fechada(s)
          </span>
          <Button onClick={apurarEmLote} disabled={selected.size === 0} style={{ marginLeft: "auto" }}>
            📤 Apurar em lote ({selected.size})
          </Button>
        </div>

        {/* Resumo — Q19: só nº de empresas e empresas fechadas */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 12, marginBottom: 14 }}>
          <Box label="Empresas" value={items.length} accent={PANEL.text} />
          <Box label="Empresas fechadas" value={fechadasCount} accent="var(--state-ok)" />
        </div>

        {error && (
          <div style={{ padding: 12, marginBottom: 12, background: "var(--danger-surface)", border: "1px solid var(--danger)", borderRadius: 6, color: "var(--danger)" }}>{error}</div>
        )}

        {/* Q44: feedback das ações (apurar em lote / fechar) — antes os notify* eram no-op invisível */}
        {(feedback?.message || feedback?.error) && (
          <div style={{ marginBottom: 12 }}>
            <Feedback message={feedback?.message} error={feedback?.error} />
          </div>
        )}

        <div style={{ overflowX: "auto", background: PANEL.surface, borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
                <th style={{ ...td, width: 36, textAlign: "center" }}>
                  {/* Q52: caixa "selecionar todas" — marca só as selecionáveis (fechadas). */}
                  <input
                    type="checkbox"
                    checked={allFechadasSelected}
                    ref={(el) => { if (el) el.indeterminate = someFechadasSelected; }}
                    onChange={selectAllFechadas}
                    disabled={fechadasCount === 0}
                    title={fechadasCount === 0 ? "Nenhuma empresa fechada para selecionar" : "Selecionar todas as empresas fechadas"}
                    style={{ cursor: fechadasCount === 0 ? "not-allowed" : "pointer" }}
                  />
                </th>
                <th style={td}>Empresa</th>
                <th style={td}>Status</th>
                <th style={{ ...td, textAlign: "right" }}>Notas</th>
                <th style={{ ...td, textAlign: "right" }}>Faturamento</th>
                <th style={{ ...td, textAlign: "right" }}>RBT12</th>
                <th style={{ ...td, textAlign: "right" }}>Fator R</th>
                <th style={{ ...td, textAlign: "right" }}>DAS</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const isFechada = it.estado === "fechada";
                return (
                  <tr key={it.portalClientId} style={{ borderTop: `1px solid ${PANEL.border}`, color: PANEL.text }}>
                    <td style={td}>
                      <input type="checkbox" disabled={!isFechada}
                        checked={selected.has(it.portalClientId)}
                        onChange={() => toggleSelect(it.portalClientId)}
                        title={isFechada ? "" : "Só empresas fechadas entram no lote"} />
                    </td>
                    <td style={td}>
                      <a onClick={() => onOpenCompanyNotas?.(it.portalClientId)} style={{ color: PANEL.accent, cursor: "pointer", fontWeight: 500 }}>{it.razao}</a>
                      <div style={{ fontSize: "0.7rem", color: PANEL.muted, fontFamily: "monospace" }}>{it.cnpj}</div>
                    </td>
                    <td style={td}><EstadoBadge estado={it.estado} /></td>
                    <td style={{ ...td, textAlign: "right" }}>{it.totalNotas}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "monospace", color: "var(--success)" }}>{fmtMoney(it.receitaEmitida)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{it.rbt12 != null ? fmtMoney(it.rbt12) : "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>{it.fatorR != null ? `${(Number(it.fatorR) * 100).toFixed(2)}%` : "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "monospace", color: "#8BE9FD" }}>
                      {/* Transmitido → simulado → nosso motor. Os três chegam separados do
                          backend desde a separação das colunas; a preferência é a da força da
                          evidência, e o `title` diz qual dos três está na célula. */}
                      {(() => {
                        const das = it.dasTransmitido != null
                          ? { v: it.dasTransmitido, t: "DAS transmitido à Receita (PGDAS-D)." }
                          : it.dasSimulado != null
                            ? { v: it.dasSimulado, t: "DAS da SIMULAÇÃO oficial (SERPRO) — nada transmitido ainda." }
                            : it.dasCalculado != null
                              ? { v: it.dasCalculado, t: "DAS calculado pelo portal (conferência), não é o valor da Receita." }
                              : null;
                        return <span title={das?.t || ""}>{das ? fmtMoney(das.v) : "—"}</span>;
                      })()}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && !loading && (
                <tr><td colSpan={8} style={{ ...td, textAlign: "center", color: PANEL.muted, padding: 24 }}>Nenhuma empresa encontrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {batchJobId && apuracaoApi && (
        <BatchProgressModal
          api={apuracaoApi}
          jobId={batchJobId}
          onClose={() => { setBatchJobId(null); reload?.(); }}
          onDone={() => reload?.()}
        />
      )}
      </AppShell>
    </PageShell>
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
