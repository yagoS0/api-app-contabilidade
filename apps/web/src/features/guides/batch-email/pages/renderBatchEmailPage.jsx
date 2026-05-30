import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Button } from "../../../../components/ui/Button";
import { Feedback } from "../../../../components/ui/Feedback";

const PANEL = {
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
  success: "#69FF47",
  warning: "#FFB347",
  danger: "#FF5757",
};

// Competência inicial = mês anterior (mesmo padrão das outras telas)
function getPreviousMonthCompetencia() {
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
}

const COLUMNS_SIMPLES = [
  { key: "DAS",      label: "DAS" },
  { key: "INSS",     label: "INSS" },
  { key: "PARC_DAS", label: "PARC", isInfoOnly: true },  // info-only: parcelamento não tem PDF próprio
];

const COLUMNS_PRESUMIDO = [
  { key: "IRPJ",       label: "IRPJ" },
  { key: "CSLL",       label: "CSLL" },
  { key: "PIS_COFINS", label: "PIS/COFINS" },
  { key: "ISS",        label: "ISS" },
  { key: "INSS",       label: "INSS" },
];

const cellBaseStyle = {
  padding: "10px 8px", textAlign: "center", fontSize: "0.8rem",
  borderBottom: `1px solid ${PANEL.border}`, whiteSpace: "nowrap",
};

function GuideStatusCell({ value, column }) {
  // null = não capturada (vermelho); valor presente = capturada (verde); info-only do PARC = laranja
  if (!value) {
    return <td style={{ ...cellBaseStyle, color: PANEL.danger }}>✗</td>;
  }
  if (column.isInfoOnly) {
    return <td style={{ ...cellBaseStyle, color: PANEL.warning }} title="Parcelamento ativo (sem PDF para anexar)">●</td>;
  }
  return (
    <td style={{ ...cellBaseStyle, color: PANEL.success }} title={value.valor != null ? `R$ ${Number(value.valor).toFixed(2)}` : "Capturada"}>
      ✓
    </td>
  );
}

function CompanySection({ title, rows, columns, selectedIds, onToggle, onToggleAll, onlyPending }) {
  // Linha tem o que enviar quando alguma coluna (exceto info-only) está preenchida
  const rowHasSendable = (row) => columns.some((c) => !c.isInfoOnly && row.tiposGuias?.[c.key]);
  const visibleRows = onlyPending ? rows.filter(rowHasSendable) : rows;

  const sendableIds = visibleRows.filter(rowHasSendable).map((r) => r.portalClientId);
  const allSelected = sendableIds.length > 0 && sendableIds.every((id) => selectedIds.has(id));
  const someSelected = sendableIds.some((id) => selectedIds.has(id));

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px", color: PANEL.text }}>
        {title} <span style={{ color: PANEL.muted, fontSize: "0.8rem", fontWeight: 400 }}>({visibleRows.length})</span>
      </h3>
      {visibleRows.length === 0 ? (
        <p style={{ color: PANEL.muted, fontSize: "0.85rem", margin: 0 }}>
          {onlyPending ? "Nenhuma empresa com guias pendentes nessa categoria." : "Nenhuma empresa cadastrada."}
        </p>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: PANEL.field }}>
                <th style={{ ...cellBaseStyle, width: 40, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={() => onToggleAll(sendableIds, !allSelected)}
                    style={{ width: 16, height: 16, cursor: "pointer", accentColor: PANEL.accent }}
                    title="Selecionar todas com pendência"
                  />
                </th>
                <th style={{ ...cellBaseStyle, textAlign: "left", color: "#aeb6d3", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.04em" }}>
                  Empresa
                </th>
                {columns.map((col) => (
                  <th key={col.key} style={{ ...cellBaseStyle, color: "#aeb6d3", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.04em" }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const hasSendable = rowHasSendable(row);
                const isSelected = selectedIds.has(row.portalClientId);
                return (
                  <tr
                    key={row.portalClientId}
                    onClick={() => hasSendable && onToggle(row.portalClientId)}
                    style={{
                      cursor: hasSendable ? "pointer" : "default",
                      background: isSelected ? "rgba(189,147,249,0.08)" : "transparent",
                      opacity: hasSendable ? 1 : 0.5,
                    }}
                  >
                    <td style={{ ...cellBaseStyle, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!hasSendable}
                        onChange={() => onToggle(row.portalClientId)}
                        style={{ width: 16, height: 16, cursor: hasSendable ? "pointer" : "not-allowed", accentColor: PANEL.accent }}
                      />
                    </td>
                    <td style={{ ...cellBaseStyle, textAlign: "left", color: PANEL.text }}>
                      <div style={{ fontWeight: 600 }}>{row.razao || "—"}</div>
                      <div style={{ fontSize: "0.7rem", color: PANEL.muted }}>{row.cnpj || ""}</div>
                    </td>
                    {columns.map((col) => (
                      <GuideStatusCell key={col.key} value={row.tiposGuias?.[col.key]} column={col} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Página "Envio de e-mails em lote".
 *
 * Mostra todas as empresas em 2 seções (Simples + Presumido), com colunas por tipo de guia.
 * - Verde ✓ = guia capturada (PENDING/ERROR, ainda não enviada)
 * - Vermelho ✗ = guia ainda não capturada
 * - Laranja ● = parcelamento ativo (info-only, sem anexo de PDF)
 *
 * O contador seleciona empresas e clica "Enviar e-mails (N)" — backend envia 1 e-mail
 * por empresa com TODAS as guias da competência anexadas. Após envio, linhas saem da matriz
 * (porque emailStatus passa a SENT, não aparecem mais).
 */
export function BatchEmailPage({
  report,
  loading,
  sending,
  onBack,
  onLoad,
  onSend,
  message,
  error,
}) {
  const [competencia, setCompetencia] = useState(getPreviousMonthCompetencia());
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [onlyPending, setOnlyPending] = useState(true);

  // Carrega ao montar e quando muda competência
  useEffect(() => {
    onLoad?.(competencia);
    setSelectedIds(new Set());  // reset seleção ao trocar competência
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencia]);

  function toggleOne(portalClientId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(portalClientId)) next.delete(portalClientId);
      else next.add(portalClientId);
      return next;
    });
  }

  function toggleAllInSection(ids, addAll) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (addAll) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const totalSelected = selectedIds.size;
  const canSend = totalSelected > 0 && !sending;

  async function handleSend() {
    if (!canSend) return;
    const items = [...selectedIds].map((portalClientId) => ({ portalClientId, competencia }));
    await onSend?.(items);
    setSelectedIds(new Set());
  }

  const simples = report?.simples || [];
  const presumidos = report?.presumidos || [];

  return (
    <PageShell
      title="Envio de e-mails em lote"
      subtitle="Selecione empresas e dispare o envio das guias capturadas (1 e-mail por empresa com PDFs anexados)."
      onBack={onBack}
      actions={
        <>
          <Button variant="secondary" onClick={() => onLoad?.(competencia)} disabled={loading}>
            {loading ? "Carregando..." : "Atualizar"}
          </Button>
          <Button variant="primary" onClick={handleSend} disabled={!canSend}>
            {sending ? "Enviando..." : `Enviar e-mails (${totalSelected})`}
          </Button>
        </>
      }
    >
      <AppShell>
        <div style={{
          display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
          marginBottom: 18, padding: "12px 14px",
          background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8,
        }}>
          <label style={{ fontSize: "0.85rem", color: PANEL.muted, display: "flex", alignItems: "center", gap: 8 }}>
            Competência:
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              style={{
                background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6,
                color: PANEL.text, padding: "6px 10px", fontSize: "0.9rem", colorScheme: "dark",
              }}
            />
          </label>
          <label style={{ fontSize: "0.85rem", color: PANEL.muted, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(e) => setOnlyPending(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: PANEL.accent, cursor: "pointer" }}
            />
            Só empresas com pendências
          </label>
          {totalSelected > 0 && (
            <div style={{ marginLeft: "auto", fontSize: "0.85rem", color: PANEL.accent, fontWeight: 600 }}>
              {totalSelected} empresa{totalSelected === 1 ? "" : "s"} selecionada{totalSelected === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {loading ? (
          <p style={{ color: PANEL.muted }}>Carregando…</p>
        ) : (
          <>
            <CompanySection
              title="Empresas — Simples Nacional"
              rows={simples}
              columns={COLUMNS_SIMPLES}
              selectedIds={selectedIds}
              onToggle={toggleOne}
              onToggleAll={toggleAllInSection}
              onlyPending={onlyPending}
            />
            <CompanySection
              title="Empresas — Lucro Presumido / Lucro Real"
              rows={presumidos}
              columns={COLUMNS_PRESUMIDO}
              selectedIds={selectedIds}
              onToggle={toggleOne}
              onToggleAll={toggleAllInSection}
              onlyPending={onlyPending}
            />
            {/* Legenda */}
            <div style={{
              marginTop: 8, padding: "10px 12px", background: PANEL.field, border: `1px solid ${PANEL.border}`,
              borderRadius: 8, fontSize: "0.75rem", color: PANEL.muted, display: "flex", gap: 24, flexWrap: "wrap",
            }}>
              <span><strong style={{ color: PANEL.success }}>✓</strong> Guia capturada — será anexada no e-mail</span>
              <span><strong style={{ color: PANEL.danger }}>✗</strong> Guia não capturada</span>
              <span><strong style={{ color: PANEL.warning }}>●</strong> Parcelamento ativo (info, sem anexo de PDF)</span>
            </div>
          </>
        )}

        <Feedback message={message} error={error} />
      </AppShell>
    </PageShell>
  );
}

export default BatchEmailPage;
