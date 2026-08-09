import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";

// Página "Rotinas" — QUEM faz o quê (tabela empresa × rotina) e QUANDO (agenda por rotina).
//
// Antes, quem capturava o quê era implícito: o worker derivava do regime (Simples→DAS+extrato,
// LP→Presumido) e tentava INSS em toda empresa. Agora é declarado e visível.
//
// O vocabulário é o REAL do SERPRO (mesmo das "Funções em lote"). PIS/COFINS/CSLL/IRPJ não são
// rotinas: os quatro vêm juntos de uma única consulta — a do Presumido — e são separados aqui
// por código de receita. Marcar "Presumido" já traz os quatro.

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => {
  const day = String(index + 1);
  const label = index >= 28 ? `Dia ${day} (fim de mês)` : `Dia ${day}`;
  return { value: day, label };
});

const ROTINA_HINT = {
  das: "Guia do DAS (Simples Nacional)",
  inss: "Guia do INSS (DCTFWeb)",
  extrato: "Extrato do PGDAS-D — gera os lançamentos",
  presumido: "Lucro Presumido: traz PIS, COFINS, CSLL e IRPJ de uma vez",
  parcelamento: "Parcelas dos parcelamentos ativos",
  pagamento: "Confirma pagamento pelo comprovante (PAGTOWEB)",
  conferencia: "Confere as NFS-e contra o ADN nacional no dia 1 — antes do fechamento",
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

export function RotinasPage({
  api,
  workerStatus,
  onRunCron,
  runningCron,
  onRefreshWorkerStatus,
  onRunPaymentConfirmation,
  onBack,
  message,
  error,
}) {
  const [rotinas, setRotinas] = useState([]);
  const [agenda, setAgenda] = useState({});
  const [empresas, setEmpresas] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningPayment, setRunningPayment] = useState(false);
  const [notice, setNotice] = useState(null); // { type: "error"|"ok", text }

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const out = await api.getRotinas();
      setRotinas(Array.isArray(out?.rotinas) ? out.rotinas : []);
      setAgenda(out?.agenda || {});
      setEmpresas(Array.isArray(out?.empresas) ? out.empresas : []);
    } catch (err) {
      setNotice({ type: "error", text: err?.message || "Falha ao carregar rotinas." });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (onRefreshWorkerStatus) onRefreshWorkerStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allSelected = empresas.length > 0 && empresas.every((e) => selectedIds.has(e.companyId));
  const someSelected = empresas.some((e) => selectedIds.has(e.companyId));

  function toggleOne(companyId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds(() => (allSelected ? new Set() : new Set(empresas.map((e) => e.companyId))));
  }

  function setRotinaEmpresa(companyId, key, value) {
    setEmpresas((prev) => prev.map((e) => (
      e.companyId === companyId ? { ...e, rotinas: { ...e.rotinas, [key]: value } } : e
    )));
  }

  // Ação em lote: aplica a rotina nas empresas selecionadas de uma vez.
  function aplicarEmLote(key, value) {
    if (!someSelected) return;
    setEmpresas((prev) => prev.map((e) => (
      selectedIds.has(e.companyId) ? { ...e, rotinas: { ...e.rotinas, [key]: value } } : e
    )));
  }

  function setAgendaCampo(key, campo, value) {
    setAgenda((prev) => ({ ...prev, [key]: { ...prev[key], [campo]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    setNotice(null);
    try {
      const payloadAgenda = {};
      for (const r of rotinas) {
        const cfg = agenda[r.key] || {};
        payloadAgenda[r.key] = {
          enabled: cfg.enabled !== false,
          day: Number(cfg.day) || 5,
          hour: Number(cfg.hour) || 7,
        };
      }
      const out = await api.saveRotinas({
        empresas: empresas.map((e) => ({ companyId: e.companyId, rotinas: e.rotinas })),
        agenda: payloadAgenda,
      });
      if (out?.agenda) setAgenda(out.agenda);
      setNotice({ type: "ok", text: "Rotinas salvas." });
    } catch (err) {
      setNotice({ type: "error", text: err?.message || "Falha ao salvar rotinas." });
    } finally {
      setSaving(false);
    }
  }

  async function handleRunPayment() {
    if (!onRunPaymentConfirmation) return;
    setRunningPayment(true);
    try { await onRunPaymentConfirmation(); } finally { setRunningPayment(false); }
  }

  // Quantas empresas fazem cada rotina — cabeçalho mostra o alcance de cada uma.
  const contagem = useMemo(() => {
    const out = {};
    for (const r of rotinas) out[r.key] = empresas.filter((e) => e.rotinas?.[r.key]).length;
    return out;
  }, [rotinas, empresas]);

  const th = { padding: "8px 6px", fontSize: "0.75rem", color: "#A7B0C0", fontWeight: 700, textAlign: "center" };
  const td = { padding: "6px", textAlign: "center" };

  return (
    <PageShell
      title="Rotinas"
      subtitle="O que cada empresa captura automaticamente, e quando."
      onBack={onBack}
    >
      <AppShell className="serpro-settings-shell">
        <div className="serpro-settings-page">
          {/* ── Agenda: um dia/hora por rotina, valendo pras empresas marcadas ── */}
          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h1 className="serpro-settings-card__title">Agenda</h1>
              <p className="serpro-settings-card__description">
                Dia e hora de cada rotina. Vale para todas as empresas marcadas nela — a captura
                roda no dia escolhido e re-tenta nos 2 dias seguintes se falhar.
              </p>
            </div>

            {loading ? (
              <p style={{ color: "#A7B0C0", margin: 0 }}>Carregando…</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 620 }}>
                  <thead>
                    <tr style={{ background: "#21222C" }}>
                      <th style={{ ...th, textAlign: "left" }}>Rotina</th>
                      <th style={th}>Ligada</th>
                      <th style={th}>Dia</th>
                      <th style={th}>Hora</th>
                      <th style={{ ...th, textAlign: "left" }}>Empresas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rotinas.map((r) => {
                      const cfg = agenda[r.key] || {};
                      const ligada = cfg.enabled !== false;
                      return (
                        <tr key={r.key} style={{ borderTop: "1px solid #2b2d45", opacity: ligada ? 1 : 0.55 }}>
                          <td style={{ padding: "6px", color: "#F8F8F2" }}>
                            <strong>{r.label}</strong>
                            <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>{ROTINA_HINT[r.key]}</div>
                          </td>
                          <td style={td}>
                            <input
                              type="checkbox"
                              checked={ligada}
                              onChange={(e) => setAgendaCampo(r.key, "enabled", e.target.checked)}
                              style={{ width: 16, height: 16, cursor: "pointer" }}
                            />
                          </td>
                          <td style={td}>
                            <select
                              value={String(cfg.day ?? 5)}
                              disabled={!ligada}
                              onChange={(e) => setAgendaCampo(r.key, "day", Number(e.target.value))}
                              style={{ background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "#F8F8F2", padding: "4px 6px", fontSize: "0.8rem", colorScheme: "dark" }}
                            >
                              {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          <td style={td}>
                            <input
                              type="time"
                              value={`${pad2(cfg.hour ?? 7)}:00`}
                              disabled={!ligada}
                              onChange={(e) => setAgendaCampo(r.key, "hour", Math.max(0, Math.min(23, Number(String(e.target.value || "07:00").split(":")[0]) || 7)))}
                              style={{ background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "#F8F8F2", padding: "4px 6px", fontSize: "0.8rem", colorScheme: "dark" }}
                            />
                          </td>
                          <td style={{ padding: "6px", color: "#A7B0C0", fontSize: "0.8rem" }}>
                            {contagem[r.key] || 0} de {empresas.length}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Tabela empresa × rotina ── */}
          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h2 className="serpro-settings-card__title">Empresas</h2>
              <p className="serpro-settings-card__description">
                Marque o que cada empresa captura. Selecione várias e use os botões do cabeçalho
                para aplicar em lote.
              </p>
            </div>

            {notice && (
              <div style={{
                margin: "0 0 12px", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem",
                background: notice.type === "error" ? "rgba(255,71,87,0.12)" : "rgba(105,255,71,0.10)",
                border: `1px solid ${notice.type === "error" ? "#FF4757" : "#69FF47"}`,
                color: notice.type === "error" ? "#FF4757" : "#69FF47",
              }}>
                {notice.text}
              </div>
            )}

            <div style={{ overflowX: "auto", border: "1px solid #2b2d45", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 820 }}>
                <thead>
                  <tr style={{ background: "#21222C" }}>
                    <th style={{ ...th, width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={toggleAll}
                        aria-label="Selecionar todas"
                        disabled={loading}
                      />
                    </th>
                    <th style={{ ...th, textAlign: "left" }}>Empresa</th>
                    <th style={{ ...th, textAlign: "left" }}>Regime</th>
                    {rotinas.map((r) => (
                      <th key={r.key} style={th} title={ROTINA_HINT[r.key]}>
                        <div>{r.label}</div>
                        {someSelected && (
                          <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 3 }}>
                            <button
                              type="button"
                              onClick={() => aplicarEmLote(r.key, true)}
                              title={`Marcar ${r.label} nas selecionadas`}
                              style={{ background: "none", border: "1px solid #69FF47", color: "#69FF47", borderRadius: 4, fontSize: "0.65rem", cursor: "pointer", padding: "0 4px" }}
                            >✓</button>
                            <button
                              type="button"
                              onClick={() => aplicarEmLote(r.key, false)}
                              title={`Desmarcar ${r.label} nas selecionadas`}
                              style={{ background: "none", border: "1px solid #FF5757", color: "#FF5757", borderRadius: 4, fontSize: "0.65rem", cursor: "pointer", padding: "0 4px" }}
                            >✕</button>
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={3 + rotinas.length} style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>Carregando…</td></tr>
                  )}
                  {!loading && empresas.length === 0 && (
                    <tr><td colSpan={3 + rotinas.length} style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>Nenhuma empresa.</td></tr>
                  )}
                  {empresas.map((e) => {
                    const checked = selectedIds.has(e.companyId);
                    const suspensa = e.status === "SUSPENSA";
                    return (
                      <tr key={e.companyId} style={{ borderTop: "1px solid #2b2d45", background: checked ? "rgba(139,233,253,0.06)" : "transparent", opacity: suspensa ? 0.5 : 1 }}>
                        <td style={td}>
                          <input type="checkbox" checked={checked} onChange={() => toggleOne(e.companyId)} aria-label={`Selecionar ${e.razao}`} />
                        </td>
                        <td style={{ padding: "6px", color: "#F8F8F2" }}>
                          {e.razao}
                          {suspensa && <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "#FFB347" }}>suspensa</span>}
                          <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>{e.cnpj}</div>
                        </td>
                        <td style={{ padding: "6px", color: "#A7B0C0", fontSize: "0.8rem" }}>
                          {e.regime === "LUCRO_PRESUMIDO" ? "Presumido" : e.regime === "SIMPLES" ? "Simples" : "—"}
                        </td>
                        {rotinas.map((r) => (
                          <td key={r.key} style={td}>
                            <input
                              type="checkbox"
                              checked={Boolean(e.rotinas?.[r.key])}
                              onChange={(ev) => setRotinaEmpresa(e.companyId, r.key, ev.target.checked)}
                              style={{ width: 15, height: 15, cursor: "pointer" }}
                              aria-label={`${r.label} para ${e.razao}`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="serpro-settings-form__actions" style={{ marginTop: 16 }}>
              <Button type="button" variant="primary" disabled={saving || loading} onClick={handleSave}>
                {saving ? "Salvando..." : "Salvar rotinas"}
              </Button>
              <Button type="button" variant="secondary" disabled={loading} onClick={load}>
                Descartar
              </Button>
            </div>
          </section>

          {/* ── Disparo manual + última execução ── */}
          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h2 className="serpro-settings-card__title">Rodar agora</h2>
              <p className="serpro-settings-card__description">
                Executa fora da agenda, respeitando as mesmas marcações da tabela.
              </p>
            </div>

            <div className="serpro-settings-form__actions">
              <Button type="button" variant="secondary" disabled={runningCron} onClick={() => onRunCron && onRunCron({})}>
                {runningCron ? "Rodando captura…" : "Rodar captura agora"}
              </Button>
              {onRunPaymentConfirmation && (
                <Button type="button" variant="secondary" disabled={runningPayment} onClick={handleRunPayment}>
                  {runningPayment ? "Consultando pagamentos…" : "Confirmar pagamentos agora"}
                </Button>
              )}
            </div>

            <div className="serpro-settings-status-grid" style={{ marginTop: 16 }}>
              <div className="serpro-settings-status-item">
                <span>Worker</span>
                <strong>{workerStatus?.workerEnabled ? "Ativo" : "Inativo"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Última captura</span>
                <strong>{formatDateTime(workerStatus?.lastRun?.updatedAt)}</strong>
              </div>
            </div>
          </section>

          <Feedback message={message} error={error} />
        </div>
      </AppShell>
    </PageShell>
  );
}
