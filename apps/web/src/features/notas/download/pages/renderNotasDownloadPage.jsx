import "../../../fiscal/serpro/pages/consultas.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Button } from "../../../../components/ui/Button";
import { rotuloRegime } from "../../../../lib/vocabulario";
import { lerFalhaDeCarga } from "../../../../lib/falhaDeCarga";

// Q48: página top-level "Download de Notas" — seleciona período + filtros + empresas e baixa os XMLs
// em um ZIP (pasta por empresa). O ZIP é gerado EM SEGUNDO PLANO no servidor (job + polling), então a
// aplicação não trava; dá pra sair da página e voltar depois ("Downloads recentes", zips valem 7 dias).

const TIPO_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "NFE", label: "NF-e" },
  { value: "NFSE", label: "NFS-e" },
];
const PAPEL_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "EMIT", label: "Emitidas" },
  { value: "DEST", label: "Recebidas" },
];
const STATUS_META = {
  processando: { label: "Processando…", color: "var(--accent-cyan)" },
  concluido: { label: "Concluído", color: "var(--success)" },
  erro: { label: "Erro", color: "var(--danger)" },
  expirado: { label: "Expirado", color: "var(--text-muted)" },
};

function currentCompetencia() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function fmtBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

// Conteúdo puro (sem PageShell) — reutilizado como aba "Download de notas" dentro de Funções em lote.
export function NotasDownloadContent({ api, companies }) {
  const [dateFrom, setDateFrom] = useState(currentCompetencia);
  const [dateTo, setDateTo] = useState(currentCompetencia);
  const [tipo, setTipo] = useState("");
  const [papel, setPapel] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [job, setJob] = useState(null); // job ativo (criado nesta visita)
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [notice, setNotice] = useState(null); // { type: "error"|"info", text }
  const [recentes, setRecentes] = useState([]);
  const [falhaRecentes, setFalhaRecentes] = useState(null);
  const [carregandoRecentes, setCarregandoRecentes] = useState(true);
  const pollTimer = useRef(null);

  const companyList = useMemo(() => (Array.isArray(companies) ? companies : []), [companies]);
  const allSelected = companyList.length > 0 && companyList.every((c) => selectedIds.has(c.companyId));
  const someSelected = companyList.some((c) => selectedIds.has(c.companyId));
  const running = job?.status === "processando";

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

  // ⚠ ISTO ERA UM `catch` SILENCIOSO, e o silêncio saía como "Nenhum download ainda." — a tela
  // afirmando que não existe ZIP nenhum quando o que houve foi a listagem falhar. O contador
  // dispara de novo a geração de um ZIP que já está pronto no servidor.
  async function loadRecentes() {
    setCarregandoRecentes(true);
    setFalhaRecentes(null);
    try {
      if (typeof api?.listNotasDownloads !== "function") {
        // Capacidade ausente é resposta, não lista vazia (acontece no modo mock parcial).
        setRecentes([]);
        setFalhaRecentes(lerFalhaDeCarga("Esta versão da API não expõe a lista de downloads.", { assunto: "os downloads recentes" }));
        return;
      }
      const out = await api.listNotasDownloads();
      if (!Array.isArray(out?.jobs)) {
        setRecentes([]);
        setFalhaRecentes(lerFalhaDeCarga(out?.message ? out : "O servidor respondeu sem a lista de downloads.", { assunto: "os downloads recentes" }));
        return;
      }
      setRecentes(out.jobs);
    } catch (err) {
      // O dado antigo sai junto: lista de antes sob um estado que não foi confirmado é pior que
      // lista nenhuma — é ela que faz o contador achar que já viu tudo o que há.
      setRecentes([]);
      setFalhaRecentes(lerFalhaDeCarga(err, { assunto: "os downloads recentes" }));
    } finally {
      setCarregandoRecentes(false);
    }
  }
  useEffect(() => { loadRecentes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Polling do job ativo (2.5s — padrão BatchProgressModal). Para quando conclui/erra.
  useEffect(() => {
    if (!job?.id || job.status !== "processando") return undefined;
    let alive = true;
    async function poll() {
      try {
        const out = await api.getNotasDownload(job.id);
        if (!alive || !out?.job) return;
        setJob(out.job);
        if (out.job.status !== "processando") {
          clearInterval(pollTimer.current);
          loadRecentes();
        }
      } catch { /* mantém polling */ }
    }
    pollTimer.current = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(pollTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  async function iniciarDownload() {
    setNotice(null);
    const ids = companyList.filter((c) => selectedIds.has(c.companyId)).map((c) => c.companyId);
    if (!ids.length) {
      setNotice({ type: "error", text: "Selecione ao menos uma empresa na tabela." });
      return;
    }
    setCreating(true);
    try {
      const out = await api.createNotasDownload({
        companyIds: ids,
        competenciaDe: dateFrom,
        competenciaAte: dateTo,
        tipo: tipo || undefined,
        papel: papel || undefined,
      });
      if (!out?.ok || !out.jobId) throw new Error(out?.message || "Falha ao criar o download.");
      setJob({ id: out.jobId, status: "processando", processadas: 0, totalEmpresas: ids.length, totalNotas: 0 });
    } catch (err) {
      setNotice({ type: "error", text: err?.message || "Falha ao criar o download." });
    } finally {
      setCreating(false);
    }
  }

  // Baixa o ZIP como blob autenticado (padrão fetchSitfisPdfBlob) e dispara o save no navegador.
  async function baixarZip(j) {
    if (!j?.id) return;
    setDownloadingId(j.id);
    setNotice(null);
    try {
      const blob = await api.fetchNotasDownloadBlob(j.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = j.arquivoNome || `notas-${j.id}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setNotice({ type: "error", text: err?.message || "Falha ao baixar o ZIP (pode ter expirado)." });
      loadRecentes();
    } finally {
      setDownloadingId(null);
    }
  }

  const progressoPct = job?.totalEmpresas
    ? Math.round(((job.processadas || 0) / job.totalEmpresas) * 100)
    : 0;

  return (
    <div className="consultas-content">
      <section className="serpro-settings-card">
        <div className="serpro-settings-card__head">
          <h2 className="serpro-settings-card__title">Baixar notas em lote</h2>
          <p className="serpro-settings-card__description">Gera um ZIP dos XMLs já salvos. Não busca notas novas.</p>
        </div>

            {/* Filtros */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                De
                <input type="month" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} disabled={creating || running} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Até
                <input type="month" value={dateTo} onChange={(e) => setDateTo(e.target.value)} disabled={creating || running} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Tipo
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={creating || running}
                  style={{ background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "var(--text)", padding: "6px 8px", fontSize: "0.85rem" }}>
                  {TIPO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Papel
                <select value={papel} onChange={(e) => setPapel(e.target.value)} disabled={creating || running}
                  style={{ background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "var(--text)", padding: "6px 8px", fontSize: "0.85rem" }}>
                  {PAPEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>

            {notice && (
              <div role={notice.type === "error" ? "alert" : "status"} style={{
                margin: "0 0 12px", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem",
                background: notice.type === "error" ? "rgba(255,71,87,0.12)" : "rgba(105,255,71,0.10)",
                border: `1px solid ${notice.type === "error" ? "var(--danger)" : "var(--success)"}`,
                color: notice.type === "error" ? "var(--danger)" : "var(--success)",
              }}>
                {notice.text}
              </div>
            )}

            {/* Progresso do job ativo */}
            {job && (
              <div style={{ margin: "0 0 14px", padding: 12, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontSize: "0.85rem", color: STATUS_META[job.status]?.color || "var(--text-muted)", fontWeight: 600 }}>
                    {STATUS_META[job.status]?.label || job.status}
                    {running && ` — ${job.processadas || 0}/${job.totalEmpresas || 0} empresa(s), ${job.totalNotas || 0} nota(s)`}
                    {job.status === "concluido" && ` — ${job.totalNotas || 0} nota(s)${job.arquivoBytes ? `, ${fmtBytes(job.arquivoBytes)}` : ""}`}
                  </div>
                  {job.status === "concluido" && (
                    <Button type="button" variant="primary" disabled={downloadingId === job.id} onClick={() => baixarZip(job)}>
                      {downloadingId === job.id ? "Baixando…" : `⬇ Baixar ZIP`}
                    </Button>
                  )}
                </div>
                {running && (
                  <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: "#1A1B26", overflow: "hidden" }}>
                    <div style={{ width: `${progressoPct}%`, height: "100%", background: "var(--accent-cyan)", transition: "width 0.4s ease" }} />
                  </div>
                )}
                {job.status === "erro" && (
                  <div style={{ marginTop: 6, fontSize: "0.8rem", color: "var(--danger)" }}>{job.erroMensagem || "Falha no processamento."}</div>
                )}
              </div>
            )}

            {/* Tabela de empresas */}
            <div role="region" aria-label="Tabela de download de notas" tabIndex={0} style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "var(--bg-subtle)", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px", width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={toggleAll}
                        aria-label="Selecionar todas"
                        disabled={creating || running}
                      />
                    </th>
                    <th style={{ padding: "8px 10px" }}>Empresa</th>
                    <th style={{ padding: "8px 10px" }}>CNPJ</th>
                    <th style={{ padding: "8px 10px" }}>Regime</th>
                  </tr>
                </thead>
                <tbody>
                  {companyList.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "var(--text-faint)" }}>Nenhuma empresa.</td></tr>
                  )}
                  {companyList.map((company) => {
                    const checked = selectedIds.has(company.companyId);
                    const regime = rotuloRegime(company.legacyCompany?.regimeTributario || company.legacyCompany?.tipoTributario) || "—";
                    return (
                      <tr key={company.companyId} style={{ borderTop: "1px solid var(--border)", background: checked ? "rgba(139,233,253,0.06)" : "transparent" }}>
                        <td style={{ padding: "8px 10px" }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleOne(company.companyId)} disabled={creating || running} aria-label={`Selecionar ${company.razao}`} />
                        </td>
                        <td style={{ padding: "8px 10px", color: "var(--text)" }}>{company.razao}</td>
                        <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>{company.cnpj}</td>
                        <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>{regime}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
              <Button type="button" variant="primary" disabled={creating || running || !someSelected} onClick={iniciarDownload}>
                {creating ? "Criando…" : "⬇ Baixar notas"}
              </Button>
              <span style={{ fontSize: "0.78rem", color: "var(--text-faint)", paddingBottom: 8 }}>
                {[...selectedIds].length} empresa(s) selecionada(s)
              </span>
            </div>
          </section>

          {/* Downloads recentes — permite sair da página e voltar pra baixar */}
          <section className="serpro-settings-card" style={{ marginTop: 16 }}>
            <div className="serpro-settings-card__head">
              <h2 className="serpro-settings-card__title">Downloads recentes</h2>
              <p className="serpro-settings-card__description">Os ZIPs ficam disponíveis por 7 dias.</p>
            </div>
            <div role="region" aria-label="Tabela de download de notas" tabIndex={0} style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "var(--bg-subtle)", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px" }}>Criado em</th>
                    <th style={{ padding: "8px 10px" }}>Período</th>
                    <th style={{ padding: "8px 10px" }}>Filtros</th>
                    <th style={{ padding: "8px 10px" }}>Empresas</th>
                    <th style={{ padding: "8px 10px" }}>Notas</th>
                    <th style={{ padding: "8px 10px" }}>Status</th>
                    <th style={{ padding: "8px 10px" }} />
                  </tr>
                </thead>
                <tbody>
                  {/* ⚠ "não carregou" × "não há" × "sem acesso" — três respostas, três linhas. */}
                  {carregandoRecentes && recentes.length === 0 && !falhaRecentes && (
                    <tr><td role="status" colSpan={7} style={{ padding: 16, textAlign: "center", color: "var(--text-faint)" }}>Carregando…</td></tr>
                  )}
                  {!carregandoRecentes && falhaRecentes && (
                    <tr>
                      <td colSpan={7} style={{ padding: 16, textAlign: "center" }}>
                        <div style={{ color: falhaRecentes.semAcesso ? "var(--text)" : "var(--danger)", fontWeight: 600 }}>
                          {falhaRecentes.titulo}
                        </div>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginTop: 4 }}>{falhaRecentes.motivo}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: 4 }}>
                          Pode haver ZIP pronto que esta lista não está mostrando — gerar de novo é refazer
                          trabalho já feito.
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <Button type="button" variant="secondary" onClick={loadRecentes}>Tentar de novo</Button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {!carregandoRecentes && !falhaRecentes && recentes.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: "var(--text-faint)" }}>Nenhum download ainda.</td></tr>
                  )}
                  {recentes.map((j) => {
                    const meta = STATUS_META[j.status] || { label: j.status, color: "var(--text-muted)" };
                    const filtros = [
                      TIPO_OPTIONS.find((o) => o.value === (j.tipo || ""))?.label,
                      PAPEL_OPTIONS.find((o) => o.value === (j.papel || ""))?.label,
                    ].filter((x) => x && x !== "Todas").join(" · ") || "Todas";
                    return (
                      <tr key={j.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>{fmtDateTime(j.createdAt)}</td>
                        <td style={{ padding: "8px 10px", color: "var(--text)" }}>{j.competenciaDe} → {j.competenciaAte}</td>
                        <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>{filtros}</td>
                        <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>{j.status === "processando" ? `${j.processadas}/${j.totalEmpresas}` : j.totalEmpresas}</td>
                        <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>{j.totalNotas}{j.arquivoBytes ? ` (${fmtBytes(j.arquivoBytes)})` : ""}</td>
                        <td style={{ padding: "8px 10px", color: meta.color, fontWeight: 600 }} title={j.erroMensagem || ""}>{meta.label}</td>
                        <td style={{ padding: "8px 10px" }}>
                          {j.status === "concluido" && (
                            <Button type="button" variant="secondary" disabled={downloadingId === j.id} onClick={() => baixarZip(j)}>
                              {downloadingId === j.id ? "Baixando…" : "⬇ Baixar"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
    </div>
  );
}

export function NotasDownloadPage({ api, companies, onBack }) {
  return (
    <PageShell
      title="Download de Notas"
      subtitle="Selecione o período, as empresas e baixe os XMLs das notas em lote (ZIP com pasta por empresa)."
      onBack={onBack}
    >
      <AppShell className="serpro-settings-shell">
        <NotasDownloadContent api={api} companies={companies} />
      </AppShell>
    </PageShell>
  );
}
