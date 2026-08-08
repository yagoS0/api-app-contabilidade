import { useMemo, useState } from "react";
import { rotuloRegime } from "../../../../lib/vocabulario";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { Tabs } from "../../../../components/ui/Tabs";
import { NotasDownloadContent } from "../../../notas/download/pages/renderNotasDownloadPage";
import { NotasCapturaContent } from "../../../notas/captura/pages/renderNotasCapturaPage";
import { PendenciasContent } from "../../../pendencias/pages/renderPendenciasPage";

// Q47: página top-level "Consultas" — separada da "Configuração SERPRO" (credenciais +
// certificado). Fluxo das buscas: (1) selecionar funções, (2) selecionar empresas, (3) Rodar.
// C10: a página deixou de se chamar "Funções em lote" e absorveu a antiga página top-level
// "Pendências", que virou a aba "Situação Fiscal" aqui dentro (consulta individual/lote +
// download em lote). A consulta por empresa continua existindo na aba da própria empresa.

// useRange=true → a função roda por competência (usa o intervalo De/Até).
// useRange=false → roda uma vez por empresa (ignora o intervalo).
const OP_DEFS = [
  { key: "das", label: "DAS", useRange: true },
  { key: "inss", label: "INSS", useRange: true },
  { key: "extrato", label: "Extrato", useRange: true },
  { key: "presumido", label: "Presumido", useRange: true },
  { key: "parcelamento", label: "Parcelamento", useRange: false },
  { key: "pagamento", label: "Confirmar pagamento", useRange: true },
  { key: "procuracao", label: "Testar procuração", useRange: false },
];

function currentCompetencia() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Expande o intervalo De..Até em uma lista de competências YYYY-MM inclusiva.
// Retorna { ok, months, error }. Cap de 12 meses para evitar disparos enormes.
function expandRange(from, to) {
  const re = /^(\d{4})-(\d{2})$/;
  const mf = String(from || "").match(re);
  const mt = String(to || "").match(re);
  if (!mf || !mt) return { ok: false, error: "Informe o intervalo De/Até." };
  const start = Number(mf[1]) * 12 + (Number(mf[2]) - 1);
  const end = Number(mt[1]) * 12 + (Number(mt[2]) - 1);
  if (end < start) return { ok: false, error: "A data inicial (De) não pode ser depois da final (Até)." };
  if (end - start > 11) return { ok: false, error: "Intervalo máximo de 12 meses por execução." };
  const months = [];
  for (let m = start; m <= end; m += 1) {
    months.push(`${String(Math.floor(m / 12)).padStart(4, "0")}-${String((m % 12) + 1).padStart(2, "0")}`);
  }
  return { ok: true, months };
}

export function SerproFuncoesPage({ api, settings, companies, onRunOp, onBack, message, error, pendenciasPanel }) {
  const [view, setView] = useState("funcoes"); // "funcoes" | "sitfis" | "captura" | "download"
  const [selectedOps, setSelectedOps] = useState(() => new Set());
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [dateFrom, setDateFrom] = useState(currentCompetencia);
  const [dateTo, setDateTo] = useState(currentCompetencia);
  const [results, setResults] = useState({}); // { [companyId]: { status, message } }
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, op: null });
  const [localNotice, setLocalNotice] = useState(null); // { type: "error"|"info", text }

  const companyList = useMemo(() => (Array.isArray(companies) ? companies : []), [companies]);

  const allSelected = companyList.length > 0 && companyList.every((c) => selectedIds.has(c.companyId));
  const someSelected = companyList.some((c) => selectedIds.has(c.companyId));
  const allOpsSelected = OP_DEFS.every((o) => selectedOps.has(o.key));
  const someOpSelected = selectedOps.size > 0;
  const usaIntervalo = OP_DEFS.some((o) => selectedOps.has(o.key) && o.useRange);

  const certReady = Boolean(settings?.certificate?.hasCertificate);
  const serproEnabled = Boolean(settings?.enabled);
  const canRun = serproEnabled && certReady && !running;

  function toggleOp(key) {
    setSelectedOps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAllOps() {
    setSelectedOps(() => (allOpsSelected ? new Set() : new Set(OP_DEFS.map((o) => o.key))));
  }
  function toggleOne(companyId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds(() => (allSelected ? new Set() : new Set(companyList.map((c) => c.companyId))));
  }

  // Roda as FUNÇÕES selecionadas × EMPRESAS selecionadas, sequencial, resultado ao vivo por linha.
  async function runSelected() {
    if (running) return;
    setLocalNotice(null);
    const ops = OP_DEFS.filter((o) => selectedOps.has(o.key));
    const ids = companyList.filter((c) => selectedIds.has(c.companyId)).map((c) => c.companyId);
    if (ops.length === 0) {
      setLocalNotice({ type: "error", text: "Selecione ao menos uma função." });
      return;
    }
    if (ids.length === 0) {
      setLocalNotice({ type: "error", text: "Selecione ao menos uma empresa na tabela." });
      return;
    }
    if (!serproEnabled) {
      setLocalNotice({ type: "error", text: "Integração SERPRO está desabilitada. Habilite e salve em Configuração SERPRO." });
      return;
    }
    if (!certReady) {
      setLocalNotice({ type: "error", text: "Certificado do procurador ausente. Envie o certificado em Configuração SERPRO." });
      return;
    }

    // Meses só são necessários se alguma função selecionada usa o intervalo.
    let months = [null];
    if (ops.some((o) => o.useRange)) {
      const range = expandRange(dateFrom, dateTo);
      if (!range.ok) {
        setLocalNotice({ type: "error", text: range.error });
        return;
      }
      months = range.months;
    }

    // Total = empresas × (funções-com-intervalo × meses + funções-sem-intervalo × 1).
    const perCompany = ops.reduce((s, o) => s + (o.useRange ? months.length : 1), 0);
    const total = ids.length * perCompany;
    setRunning(true);
    setProgress({ done: 0, total, op: ops.map((o) => o.label).join("+") });
    setResults((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { status: "running", message: null };
      return next;
    });

    let done = 0;
    let okCount = 0;
    let errCount = 0;
    for (const companyId of ids) {
      let firstError = null;
      let companyOk = 0;
      let lastMessage = null;
      for (const o of ops) {
        const monthsForOp = o.useRange ? months : [null];
        for (const month of monthsForOp) {
          // eslint-disable-next-line no-await-in-loop
          const res = await onRunOp(o.key, companyId, month);
          done += 1;
          setProgress((p) => ({ ...p, done }));
          if (res?.message) lastMessage = res.message;
          if (res?.ok) companyOk += 1;
          else if (!firstError) firstError = `${o.label}${month ? ` ${month}` : ""}: ${res?.message || "falha"}`;
        }
      }
      if (firstError) {
        errCount += 1;
        setResults((prev) => ({ ...prev, [companyId]: { status: "erro", message: firstError } }));
      } else {
        okCount += 1;
        setResults((prev) => ({ ...prev, [companyId]: { status: "ok", message: lastMessage || `${companyOk} operação(ões) ok` } }));
      }
    }

    setRunning(false);
    setProgress({ done: 0, total: 0, op: null });
    setLocalNotice({
      type: errCount ? "error" : "info",
      text: `Concluído: ${okCount} empresa(s) ok${errCount ? `, ${errCount} com erro (ver coluna Resultado)` : ""}.`,
    });
  }

  function renderResultCell(companyId) {
    const r = results[companyId];
    if (!r || r.status === "idle") return <span style={{ color: "#6b7280" }}>—</span>;
    if (r.status === "running") return <span style={{ color: "#8BE9FD" }}>⏳ rodando…</span>;
    if (r.status === "ok") return <span style={{ color: "#69FF47", fontSize: "0.78rem" }} title={r.message || ""}>✓ {r.message || "ok"}</span>;
    return <span style={{ color: "#FF4757", fontSize: "0.78rem" }} title={r.message || ""}>⚠ {r.message || "erro"}</span>;
  }

  // ⚠ Isto NÃO é aba — é a pílula de SELEÇÃO das funções, e cada uma embrulha um checkbox. Aba
  // escolhe UMA e troca o conteúdo; aqui marcam-se várias e nada muda de tela. Por isso continua
  // com contorno e tinta (o vocabulário de "marcado") em vez de virar `Tabs`.
  const chip = (active) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20,
    border: `1px solid ${active ? "var(--accent-purple)" : "var(--border)"}`,
    background: active ? "var(--accent-purple-surface)" : "transparent",
    color: active ? "var(--text)" : "var(--state-neutral)", fontSize: "0.82rem", fontWeight: 600,
    cursor: running ? "default" : "pointer", userSelect: "none",
  });

  return (
    <PageShell
      title="Consultas"
      subtitle="Buscas SERPRO em lote, situação fiscal, consulta de notas no ADN/SEFAZ e download de XML por período."
      onBack={onBack}
    >
      <AppShell className="serpro-settings-shell">
        <div>
          {/* Mini-nav. ⚠ "Consultar notas" vem ANTES de "Download de notas" de propósito: consultar
              é o que traz nota nova do ADN/SEFAZ; baixar só empacota o que já está no banco. Na
              ordem contrária, quem procurava "buscar as notas" achava primeiro a aba que não busca
              nada — e concluía, com um ZIP vazio na mão, que não havia notas. */}
          <Tabs
            ariaLabel="Consultas"
            align="start"
            style={{ marginBottom: 16 }}
            items={[
              { key: "funcoes", label: "Buscas SERPRO" },
              { key: "sitfis", label: "Situação Fiscal" },
              { key: "captura", label: "Consultar notas" },
              { key: "download", label: "Download de notas" },
            ]}
            active={view}
            onChange={setView}
          />

          {view === "captura" ? (
            <NotasCapturaContent api={api} companies={companies} />
          ) : view === "download" ? (
            <NotasDownloadContent api={api} companies={companies} />
          ) : view === "sitfis" ? (
            <PendenciasContent pendenciasPanel={pendenciasPanel} />
          ) : (
          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h1 className="serpro-settings-card__title">Buscas SERPRO</h1>
              <p className="serpro-settings-card__description">
                1) marque as funções · 2) marque as empresas na tabela · 3) clique em <strong>Rodar</strong>.
                As credenciais e o certificado ficam em <strong>Configuração SERPRO</strong>.
              </p>
            </div>

            {(!serproEnabled || !certReady) && (
              <div style={{ margin: "0 0 12px", padding: "10px 12px", borderRadius: 6, background: "rgba(255,179,71,0.15)", border: "1px solid #FFB347", color: "#FFB347", fontSize: "0.85rem" }}>
                {!serproEnabled && <div>⚠ Integração SERPRO desabilitada — habilite e salve em Configuração SERPRO.</div>}
                {!certReady && <div>⚠ Certificado do procurador ausente — envie o PFX/P12 em Configuração SERPRO.</div>}
              </div>
            )}

            {/* 1) Funções */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#A7B0C0", textTransform: "uppercase", letterSpacing: "0.04em" }}>Funções</span>
                <button type="button" disabled={running} onClick={toggleAllOps}
                  style={{ background: "none", border: "none", color: "#8BE9FD", fontSize: "0.78rem", cursor: running ? "default" : "pointer", padding: 0 }}>
                  {allOpsSelected ? "limpar" : "selecionar todas"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {OP_DEFS.map((o) => {
                  const active = selectedOps.has(o.key);
                  return (
                    <label key={o.key} style={chip(active)} title={o.useRange ? "Usa o intervalo De/Até" : "Roda uma vez (ignora o intervalo)"}>
                      <input type="checkbox" checked={active} disabled={running} onChange={() => toggleOp(o.key)} style={{ cursor: running ? "default" : "pointer" }} />
                      {o.label}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 2) Intervalo (só quando alguma função usa competência) */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14, opacity: usaIntervalo ? 1 : 0.5 }}>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", color: "#A7B0C0" }}>
                De
                <input type="month" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} disabled={running || !usaIntervalo} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", color: "#A7B0C0" }}>
                Até
                <input type="month" value={dateTo} onChange={(event) => setDateTo(event.target.value)} disabled={running || !usaIntervalo} />
              </label>
              {!usaIntervalo && someOpSelected && (
                <span style={{ fontSize: "0.75rem", color: "#6b7280", paddingBottom: 4 }}>As funções escolhidas ignoram o intervalo.</span>
              )}
            </div>

            {/* 3) Rodar */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
              <Button type="button" variant="primary" disabled={!canRun || !someOpSelected || !someSelected} onClick={runSelected}>
                {running ? `Rodando… (${progress.done}/${progress.total})` : "▶ Rodar"}
              </Button>
              <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                {selectedOps.size} função(ões) · {[...selectedIds].length} empresa(s) selecionada(s)
              </span>
            </div>

            {localNotice && (
              <div style={{
                margin: "0 0 12px", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem",
                background: localNotice.type === "error" ? "rgba(255,71,87,0.12)" : "rgba(105,255,71,0.10)",
                border: `1px solid ${localNotice.type === "error" ? "#FF4757" : "#69FF47"}`,
                color: localNotice.type === "error" ? "#FF4757" : "#69FF47",
              }}>
                {localNotice.text}
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
                    <th style={{ padding: "8px 10px" }}>Regime</th>
                    <th style={{ padding: "8px 10px" }}>Procuração</th>
                    <th style={{ padding: "8px 10px" }}>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {companyList.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>Nenhuma empresa.</td></tr>
                  )}
                  {companyList.map((company) => {
                    const checked = selectedIds.has(company.companyId);
                    // Sem rotuloRegime aqui a tabela mostrava "LUCRO_PRESUMIDO" — enum cru, com
                    // underline, enquanto o card do dashboard já dizia "Presumido".
                    const regime = rotuloRegime(company.legacyCompany?.regimeTributario || company.legacyCompany?.tipoTributario) || "—";
                    const proc = company.serproStatus?.procurationStatus || company.serproStatus?.status || "—";
                    return (
                      <tr key={company.companyId} style={{ borderTop: "1px solid #2b2d45", background: checked ? "rgba(189,147,249,0.06)" : "transparent" }}>
                        <td style={{ padding: "8px 10px" }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleOne(company.companyId)} disabled={running} aria-label={`Selecionar ${company.razao}`} />
                        </td>
                        <td style={{ padding: "8px 10px", color: "#F8F8F2" }}>{company.razao}</td>
                        <td style={{ padding: "8px 10px", color: "#A7B0C0" }}>{company.cnpj}</td>
                        <td style={{ padding: "8px 10px", color: "#A7B0C0" }}>{regime}</td>
                        <td style={{ padding: "8px 10px", color: "#A7B0C0" }}>{proc}</td>
                        <td style={{ padding: "8px 10px" }}>{renderResultCell(company.companyId)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          )}

          <Feedback message={message} error={error} />
        </div>
      </AppShell>
    </PageShell>
  );
}
