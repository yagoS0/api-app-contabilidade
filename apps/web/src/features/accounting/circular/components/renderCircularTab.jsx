import { useState, useMemo } from "react";
import { BaixaModal } from "../../baixa/components/renderBaixaModal";

const SUBTIPO_ROWS = [
  { key: "DAS",             label: "DAS / Simples Nacional" },
  { key: "IRRF",            label: "IRRF" },
  { key: "ISS",             label: "ISS" },
  { key: "PIS_COFINS",      label: "PIS/COFINS" },
  { key: "FGTS",            label: "FGTS" },
  { key: "FERIAS",          label: "Férias" },
  { key: "DECIMO_TERCEIRO", label: "13º Salário" },
  { key: "OUTROS_TRIBUTOS", label: "Outros Tributos" },
];

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function fmtMoney(val) {
  const n = Number(val);
  if (!n) return null;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PagamentoCell({ entry, onBaixa }) {
  if (!entry) {
    return (
      <td style={{
        padding: "6px 4px", textAlign: "center", fontSize: "0.75rem",
        color: "#d1d5db", borderRight: "1px solid #e5e7eb",
      }}>
        —
      </td>
    );
  }

  // Placeholder (TEMPLATE sem valor) → célula amarela
  if (entry.placeholder || entry.origem === "TEMPLATE") {
    return (
      <td style={{ background: "#fffbeb", padding: "5px 4px", textAlign: "center", borderRight: "1px solid #e5e7eb", minWidth: 80 }}>
        <span style={{
          display: "inline-block", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.04em",
          textTransform: "uppercase", padding: "1px 5px", borderRadius: 999,
          background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d",
        }}>
          PREENCHER
        </span>
        <div style={{ fontSize: "0.65rem", color: "#92400e", marginTop: 2 }}>sem valor</div>
      </td>
    );
  }

  const isAberto = entry.statusPagamento === "ABERTO";
  const bg          = isAberto ? "#fef2f2" : "#f0fdf4";
  const badgeBg     = isAberto ? "#fee2e2" : "#dcfce7";
  const badgeColor  = isAberto ? "#dc2626" : "#16a34a";
  const badgeBorder = isAberto ? "#fca5a5" : "#86efac";
  const badgeLabel  = isAberto ? "ABERTO" : "PAGO";

  return (
    <td style={{ background: bg, padding: "5px 4px", textAlign: "center", borderRight: "1px solid #e5e7eb", minWidth: 80 }}>
      <span style={{
        display: "inline-block", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.04em",
        textTransform: "uppercase", padding: "1px 5px", borderRadius: 999,
        background: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}`,
      }}>
        {badgeLabel}
      </span>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, marginTop: 2, whiteSpace: "nowrap" }}>
        {fmtMoney(entry.valor || entry.totalD) ? `R$ ${fmtMoney(entry.valor || entry.totalD)}` : "—"}
      </div>
      {isAberto && onBaixa && (
        <button
          onClick={() => onBaixa(entry)}
          style={{
            marginTop: 3, fontSize: "0.6rem", fontWeight: 700, cursor: "pointer",
            background: "#dc2626", color: "white", border: "none",
            borderRadius: 3, padding: "2px 6px", whiteSpace: "nowrap",
          }}
        >
          Dar Baixa
        </button>
      )}
    </td>
  );
}

function FaturamentoCell({ valor }) {
  return (
    <td style={{ padding: "6px 4px", textAlign: "center", fontSize: "0.75rem", borderRight: "1px solid #e5e7eb" }}>
      {valor ? (
        <span style={{ fontWeight: 700, color: "#1d4ed8" }}>R$ {fmtMoney(valor)}</span>
      ) : (
        <span style={{ color: "#d1d5db" }}>—</span>
      )}
    </td>
  );
}

export function CircularTab({
  circularData,
  loading,
  year,
  onYearChange,
  onLoad,
  accounts,
  onCreateBaixa,
  savingBaixa,
}) {
  const [baixaEntry, setBaixaEntry] = useState(null);
  const currentYear = new Date().getFullYear();

  const matrix = useMemo(() => {
    if (!circularData?.provisoes) return {};
    const map = {};
    for (const p of circularData.provisoes) {
      if (!p.subtipo) continue;
      const k = `${p.subtipo}__${p.competencia}`;
      const existing = map[k];
      // Preferência: ABERTO real > PAGO > TEMPLATE (placeholder)
      if (!existing) { map[k] = p; continue; }
      const isTemplate = (e) => e.placeholder || e.origem === "TEMPLATE";
      if (isTemplate(existing) && !isTemplate(p)) { map[k] = p; continue; }
      if (!isTemplate(existing) && p.statusPagamento === "ABERTO" && !isTemplate(p)) { map[k] = p; }
    }
    return map;
  }, [circularData]);

  const visibleRows = useMemo(() => {
    if (!circularData?.provisoes) return SUBTIPO_ROWS;
    const usedSubtipos = new Set(circularData.provisoes.map((p) => p.subtipo).filter(Boolean));
    return SUBTIPO_ROWS.filter((r) => usedSubtipos.has(r.key));
  }, [circularData]);

  // Totais por mês para linha de saldo em aberto
  const abertoByMonth = useMemo(() => {
    if (!circularData?.provisoes) return {};
    const totals = {};
    for (const p of circularData.provisoes) {
      if (p.statusPagamento === "ABERTO" && !p.placeholder && p.origem !== "TEMPLATE") {
        totals[p.competencia] = (totals[p.competencia] || 0) + (Number(p.totalD) || 0);
      }
    }
    return totals;
  }, [circularData]);

  const monthKeys = MONTH_LABELS.map((_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  return (
    <div style={{ padding: "var(--space-3) var(--space-4)", width: "100%", background: "var(--bg-surface)" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Circular — Provisões e Pagamentos</h2>

        {/* Seletor de ano */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <button
            onClick={() => onYearChange(year - 1)}
            style={{
              background: "white", border: "1px solid var(--border)", borderRadius: 4,
              width: 28, height: 28, cursor: "pointer", fontSize: "0.875rem",
            }}
          >
            ←
          </button>
          <span style={{ fontWeight: 700, fontSize: "1rem", minWidth: 48, textAlign: "center" }}>{year}</span>
          <button
            onClick={() => onYearChange(year + 1)}
            disabled={year >= currentYear + 1}
            style={{
              background: "white", border: "1px solid var(--border)", borderRadius: 4,
              width: 28, height: 28, cursor: year >= currentYear + 1 ? "default" : "pointer",
              fontSize: "0.875rem", opacity: year >= currentYear + 1 ? 0.4 : 1,
            }}
          >
            →
          </button>
          <button
            onClick={() => onLoad(year)}
            style={{
              background: "white", border: "1px solid var(--border)", borderRadius: 4,
              height: 28, padding: "0 10px", cursor: "pointer", fontSize: "0.8125rem",
            }}
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* Legenda */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: "0.75rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fee2e2", border: "1px solid #fca5a5", display: "inline-block" }} />
          Em aberto
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#dcfce7", border: "1px solid #86efac", display: "inline-block" }} />
          Pago
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fffbeb", border: "1px solid #fcd34d", display: "inline-block" }} />
          Aguardando valor
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#eff6ff", border: "1px solid #bfdbfe", display: "inline-block" }} />
          Faturamento
        </span>
      </div>

      {loading && (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>Carregando...</p>
      )}

      {!loading && !circularData && (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>
          Nenhum dado disponível. Clique em Atualizar.
        </p>
      )}

      {!loading && circularData && (
        <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", tableLayout: "auto" }}>
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={{
                  padding: "6px 10px", textAlign: "left", fontSize: "0.7rem", fontWeight: 700,
                  color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em",
                  borderRight: "2px solid #d1d5db", borderBottom: "2px solid #d1d5db",
                  position: "sticky", left: 0, background: "#f3f4f6", zIndex: 10,
                  minWidth: 160,
                }}>
                  Obrigação
                </th>
                {MONTH_LABELS.map((m, i) => (
                  <th key={i} style={{
                    padding: "6px 4px", textAlign: "center", fontSize: "0.7rem", fontWeight: 700,
                    color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em",
                    borderRight: "1px solid #e5e7eb", borderBottom: "2px solid #d1d5db",
                    minWidth: 80,
                  }}>
                    {m}/{String(year).slice(2)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontStyle: "italic" }}>
                    Nenhuma provisão registrada para {year}. Crie lançamentos do tipo Provisão na aba Lançamentos.
                  </td>
                </tr>
              )}
              {visibleRows.map((row) => (
                <tr key={row.key}>
                  <td style={{
                    padding: "6px 10px", fontWeight: 600, fontSize: "0.8125rem",
                    borderRight: "2px solid #d1d5db", borderBottom: "1px solid #e5e7eb",
                    position: "sticky", left: 0, background: "white", zIndex: 5,
                    whiteSpace: "nowrap",
                  }}>
                    {row.label}
                  </td>
                  {monthKeys.map((comp) => (
                    <PagamentoCell
                      key={comp}
                      entry={matrix[`${row.key}__${comp}`]}
                      onBaixa={(entry) => setBaixaEntry(entry)}
                    />
                  ))}
                </tr>
              ))}

              {/* Linha de Total em Aberto */}
              <tr style={{ borderTop: "2px solid #d1d5db", background: "#fef2f2" }}>
                <td style={{
                  padding: "6px 10px", fontWeight: 700, fontSize: "0.8125rem",
                  borderRight: "2px solid #d1d5db",
                  position: "sticky", left: 0, background: "#fef2f2", zIndex: 5,
                  whiteSpace: "nowrap", color: "#dc2626",
                }}>
                  Total em Aberto
                </td>
                {monthKeys.map((comp) => {
                  const total = abertoByMonth[comp];
                  return (
                    <td key={comp} style={{ padding: "6px 4px", textAlign: "center", borderRight: "1px solid #e5e7eb" }}>
                      {total ? (
                        <span style={{ fontWeight: 700, fontSize: "0.75rem", color: "#dc2626" }}>
                          R$ {fmtMoney(total)}
                        </span>
                      ) : (
                        <span style={{ color: "#d1d5db", fontSize: "0.75rem" }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Linha de Faturamento */}
              <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{
                  padding: "6px 10px", fontWeight: 600, fontSize: "0.8125rem",
                  borderRight: "2px solid #d1d5db",
                  position: "sticky", left: 0, background: "#eff6ff", zIndex: 5,
                  whiteSpace: "nowrap",
                }}>
                  Faturamento
                </td>
                {monthKeys.map((comp) => (
                  <FaturamentoCell key={comp} valor={circularData.receitas?.[comp]} />
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {baixaEntry && (
        <BaixaModal
          entry={baixaEntry}
          accounts={accounts}
          saving={savingBaixa}
          onSave={async (input) => {
            await onCreateBaixa(baixaEntry.id, input);
            setBaixaEntry(null);
          }}
          onClose={() => setBaixaEntry(null)}
        />
      )}
    </div>
  );
}
