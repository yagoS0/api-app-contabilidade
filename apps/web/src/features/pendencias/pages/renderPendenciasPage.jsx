// Q41: página top-level "Pendências" (situação fiscal / SITFIS por empresa).
// Marca por palavra-chave (backend) COM_PENDENCIA/REGULAR/PROCESSANDO. Consulta individual + em lote.

import { useMemo, useState } from "react";
import { Feedback } from "../../../components/ui/Feedback";
import { Button } from "../../../components/ui/Button";

const SITUACAO_META = {
  COM_PENDENCIA: { label: "Com pendência", color: "var(--danger)", bg: "rgba(255,71,87,0.12)" },
  EM_PARCELAMENTO: { label: "Em parcelamento", color: "#8BE9FD", bg: "rgba(139,233,253,0.12)" },
  REGULAR: { label: "Regular", color: "var(--success)", bg: "rgba(105,255,71,0.10)" },
  PROCESSANDO: { label: "Processando", color: "#FFB347", bg: "rgba(255,179,71,0.12)" },
};

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function SituacaoBadge({ situacao }) {
  const meta = SITUACAO_META[situacao] || { label: "Sem consulta", color: "#A7B0C0", bg: "rgba(167,176,192,0.10)" };
  return (
    <span style={{ padding: "3px 9px", borderRadius: 999, fontSize: "0.8rem", fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}` }}>
      {meta.label}
    </span>
  );
}

// C10: o conteúdo vive separado do PageShell porque agora ele é EMBUTIDO como a aba
// "Situação Fiscal" dentro de Consultas (mesmo padrão do NotasDownloadContent).
export function PendenciasContent({ pendenciasPanel }) {
  const { items, loading, error, running, progress, consultarUma, consultarLote, baixando, baixarLote } = pendenciasPanel || {};
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [onlyPendencia, setOnlyPendencia] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);

  const rows = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    return onlyPendencia ? list.filter((r) => r.situacao === "COM_PENDENCIA") : list;
  }, [items, onlyPendencia]);

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.companyId));
  const someSelected = rows.some((r) => selectedIds.has(r.companyId));

  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds(() => (allSelected ? new Set() : new Set(rows.map((r) => r.companyId))));
  }

  async function handleConsultarUma(id) {
    setRowBusy(id);
    try {
      await consultarUma?.(id);
    } finally {
      setRowBusy(null);
    }
  }

  const comPendencia = (items || []).filter((r) => r.situacao === "COM_PENDENCIA").length;
  const emParcelamento = (items || []).filter((r) => r.situacao === "EM_PARCELAMENTO").length;

  return (
        <div style={{ padding: 8 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "#21222C", border: "1px solid #44475A" }}>
              <div style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>Empresas</div>
              <div style={{ color: "#F8F8F2", fontSize: "1.4rem", fontWeight: 700 }}>{(items || []).length}</div>
            </div>
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(255,71,87,0.10)", border: "1px solid var(--danger)" }}>
              <div style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>Com pendência</div>
              <div style={{ color: "var(--danger)", fontSize: "1.4rem", fontWeight: 700 }}>{comPendencia}</div>
            </div>
            {emParcelamento > 0 && (
              <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(139,233,253,0.08)", border: "1px solid #8BE9FD" }}>
                <div style={{ color: "#A7B0C0", fontSize: "0.8rem" }}>Em parcelamento</div>
                <div style={{ color: "#8BE9FD", fontSize: "1.4rem", fontWeight: 700 }}>{emParcelamento}</div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <Button
              type="button"
              variant="primary"
              disabled={!someSelected || running}
              onClick={() => consultarLote?.(rows.filter((r) => selectedIds.has(r.companyId)).map((r) => r.companyId))}
            >
              {running ? `Consultando… (${progress.done}/${progress.total})` : "Consultar selecionadas"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!someSelected || baixando || running}
              onClick={() => baixarLote?.(rows.filter((r) => selectedIds.has(r.companyId)).map((r) => r.companyId))}
              title="Baixa um ZIP com os PDFs de situação fiscal das empresas selecionadas."
            >
              {baixando ? "Baixando…" : "⬇ Baixar em lote"}
            </Button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#A7B0C0", fontSize: "0.85rem" }}>
              <input type="checkbox" checked={onlyPendencia} onChange={(e) => setOnlyPendencia(e.target.checked)} />
              Só com pendência
            </label>
          </div>

          {error && (
            <div style={{ margin: "0 0 12px", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem", background: "rgba(255,71,87,0.12)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
              {error}
            </div>
          )}

          <div style={{ overflowX: "auto", border: "1px solid #2b2d45", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#21222C", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px", width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleAll}
                      aria-label="Selecionar todas"
                      disabled={running}
                    />
                  </th>
                  <th style={{ padding: "8px 10px" }}>Empresa</th>
                  <th style={{ padding: "8px 10px" }}>CNPJ</th>
                  <th style={{ padding: "8px 10px" }}>Situação</th>
                  <th style={{ padding: "8px 10px" }}>Última consulta</th>
                  <th style={{ padding: "8px 10px" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} style={{ padding: 16, textAlign: "center", color: "#A7B0C0" }}>Carregando…</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 16, textAlign: "center", color: "var(--text-faint)" }}>Nenhuma empresa.</td></tr>
                )}
                {!loading && rows.map((r) => {
                  const checked = selectedIds.has(r.companyId);
                  return (
                    <tr key={r.companyId} style={{ borderTop: "1px solid #2b2d45", background: checked ? "rgba(189,147,249,0.06)" : "transparent" }}>
                      <td style={{ padding: "8px 10px" }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleOne(r.companyId)} disabled={running} aria-label={`Selecionar ${r.razao}`} />
                      </td>
                      <td style={{ padding: "8px 10px", color: "#F8F8F2" }}>{r.razao}</td>
                      <td style={{ padding: "8px 10px", color: "#A7B0C0" }}>{r.cnpj}</td>
                      <td style={{ padding: "8px 10px" }}><SituacaoBadge situacao={r.situacao} /></td>
                      <td style={{ padding: "8px 10px", color: "#A7B0C0" }}>{formatDateTime(r.checkedAt)}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={running || rowBusy === r.companyId}
                          onClick={() => handleConsultarUma(r.companyId)}
                        >
                          {rowBusy === r.companyId ? "Consultando…" : "Consultar"}
                        </Button>
                        {r.relatorioPdfFileId && (
                          <span style={{ marginLeft: 8, color: "#8BE9FD", fontSize: "0.78rem" }} title="Relatório em PDF disponível">📄</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 12, color: "var(--text-faint)", fontSize: "0.78rem" }}>
            A marcação de pendência é derivada do relatório SITFIS por palavra-chave (aproximada) — confirme
            sempre no relatório completo. A consulta ao SERPRO só funciona com a integração SITFIS habilitada.
          </p>

          <Feedback message={null} error={null} />
        </div>
  );
}
