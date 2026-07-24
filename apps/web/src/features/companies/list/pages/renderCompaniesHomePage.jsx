import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { CompanyCard, getComplianceTags } from "../components/renderCompanyCard";

// Q17: dropdown de "Configurações" — abre um seletor (não navega para um hub).
function SettingsMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);
  const usable = items.filter((it) => typeof it.onClick === "function");
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <Button variant="secondary" className="dashboard-home__action" onClick={() => setOpen((o) => !o)}>
        Configurações ▾
      </Button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "#24253A", border: "1px solid #44475A", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 220, overflow: "hidden",
        }}>
          {usable.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => { setOpen(false); it.onClick(); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "9px 14px",
                background: "transparent", border: "none", color: "#F8F8F2", cursor: "pointer", fontSize: "0.85rem",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#2f3147"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasPendingCompliance(company) {
  return getComplianceTags(company?.guideCompliance).some((tag) => !tag.ok);
}

// Q17: filtros compactos (campos menores), com competência junto deles.
const FILTER_LABEL = { display: "grid", gap: 3, fontSize: "0.68rem", color: "#aeb6d3", textTransform: "uppercase", letterSpacing: "0.03em" };
const FILTER_CONTROL = { background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "#F8F8F2", padding: "5px 8px", fontSize: "0.8rem", colorScheme: "dark" };
// C7: setas de navegação da competência (‹ ›).
const COMP_ARROW = { ...FILTER_CONTROL, padding: "5px 9px", cursor: "pointer", fontWeight: 700, lineHeight: 1 };

// C7: anda N meses na competência YYYY-MM (aceita negativo). Sem dependência de Date pra não
// escorregar em fuso — é aritmética de ano/mês pura.
function shiftCompetencia(competencia, delta) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return competencia;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

export function CompaniesHomePage({
  user,
  companies,
  loadingCompanies,
  onCreateCompany,
  onOpenGuideUpload,
  onOpenGuideSettings,
  onOpenChartGlobal,
  onRefreshCompanies,
  onOpenPendingReport,
  onOpenBatchEmail,
  onOpenApuracao,
  onOpenRotinas,
  onOpenPendencias,
  onOpenSerproFuncoes,
  onLogout,
  onOpenCompany,
  globalChartStatus, // { isConfigured, tiposFaltantes, ... } — pré-requisito para criar empresa
  dashboardCompetencia, // Q17: competência do filtro (default mês anterior)
  onChangeCompetencia,
  message,
  error,
}) {
  const [search, setSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState("pending");
  const [serproFilter, setSerproFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("all"); // all | sent | notSent (Q16)
  const [apuracaoFilter, setApuracaoFilter] = useState("all"); // all | apurados | naoApurados
  const [certFilter, setCertFilter] = useState("all"); // all | comCert | semCert
  // C7: os filtros secundários ficam num painel; só busca e competência seguem aparentes.
  const [showFilters, setShowFilters] = useState(false);
  // "pending" é o default de Documentos (não conta como filtro ativo).
  const filtrosAtivos = [
    documentFilter !== "pending",
    serproFilter !== "all",
    emailFilter !== "all",
    apuracaoFilter !== "all",
    certFilter !== "all",
  ].filter(Boolean).length;
  function limparFiltros() {
    setDocumentFilter("pending");
    setSerproFilter("all");
    setEmailFilter("all");
    setApuracaoFilter("all");
    setCertFilter("all");
  }

  const filteredCompanies = useMemo(() => {
    const normalizedQuery = normalizeSearch(search);

    // 1) Busca por nome/CNPJ continua filtrando (remove quem não bate).
    //    Q16: filtro "Enviados/Só não enviados" também REMOVE quem não bate.
    //    Novos filtros (apuração / certificado) também REMOVEM quem não bate.
    const searched = companies.filter((company) => {
      if (emailFilter === "notSent" && company?.monthEmailSent) return false;
      if (emailFilter === "sent" && !company?.monthEmailSent) return false;
      if (apuracaoFilter === "apurados" && !company?.apuracao?.apurada) return false;
      if (apuracaoFilter === "naoApurados" && company?.apuracao?.apurada) return false;
      const temCert = Boolean(company?.legacyCompany?.certStorageKey);
      if (certFilter === "comCert" && !temCert) return false;
      if (certFilter === "semCert" && temCert) return false;
      if (!normalizedQuery) return true;
      return (
        normalizeSearch(company?.razao).includes(normalizedQuery) ||
        normalizeSearch(company?.cnpj).includes(normalizedQuery)
      );
    });

    // 2) Filtros de documento e SERPRO agora apenas REORDENAM:
    //    quem bate no critério vai pra frente, sem remover ninguém.
    function priority(company) {
      let p = 0;
      if (documentFilter === "pending" && hasPendingCompliance(company)) p += 2;
      if (documentFilter === "ok" && !hasPendingCompliance(company)) p += 2;
      if (serproFilter === "eligible" && company?.serproStatus?.eligible) p += 1;
      if (serproFilter === "ineligible" && !company?.serproStatus?.eligible) p += 1;
      return p;
    }

    // Ordena estável por prioridade desc; preserva ordem original como tiebreaker.
    return searched
      .map((company, index) => ({ company, index, p: priority(company) }))
      .sort((a, b) => (b.p - a.p) || (a.index - b.index))
      .map((item) => item.company);
  }, [companies, documentFilter, search, serproFilter, emailFilter, apuracaoFilter, certFilter]);

  return (
    <div className="dashboard-home-page">
      <AppShell className="dashboard-home-shell">
        <section className="dashboard-home">
          <header className="dashboard-home__header">
            <div className="dashboard-home__brand">
              <div>
                <h1 className="dashboard-home__title">Dashboard de empresas</h1>
                <p className="dashboard-home__subtitle">
                  Busca, filtros e acesso rapido para a carteira do escritorio.
                </p>
              </div>
            </div>

            <div className="dashboard-home__user">
              <div className="dashboard-home__user-meta">
                <span className="dashboard-home__user-label">Contador logado</span>
                <strong className="dashboard-home__user-name">{user?.name || "Conta escritorio"}</strong>
              </div>
              <Button variant="secondary" className="dashboard-home__logout" onClick={onLogout}>
                Sair
              </Button>
            </div>
          </header>

          {globalChartStatus && !globalChartStatus.isConfigured && (
            <div
              role="alert"
              style={{
                margin: "12px 0",
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(255,179,71,0.15)",
                border: "1px solid #FFB347",
                color: "#FFB347",
                fontSize: "0.875rem",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span>
                ⚠ <strong>Plano de contas global incompleto</strong>. Antes de criar novas empresas,
                cadastre contas dos tipos:{" "}
                <strong>{(globalChartStatus.tiposFaltantes || []).join(", ") || "—"}</strong>.
              </span>
              {onOpenChartGlobal && (
                <Button variant="secondary" onClick={onOpenChartGlobal}>
                  Abrir Plano de Contas Global
                </Button>
              )}
            </div>
          )}

          <nav className="dashboard-home__actions" aria-label="Atalhos">
            <Button
              variant="success"
              className="dashboard-home__action dashboard-home__action--success"
              onClick={() => {
                if (globalChartStatus && !globalChartStatus.isConfigured) {
                  const faltantes = (globalChartStatus.tiposFaltantes || []).join(", ");
                  window.alert(
                    "Configure o plano de contas global antes de criar empresas.\n\n"
                    + `Faltam contas dos tipos: ${faltantes}.\n\n`
                    + "Acesse: Configurações da Firma → Plano de Contas Global."
                  );
                  return;
                }
                onCreateCompany();
              }}
              title={
                globalChartStatus && !globalChartStatus.isConfigured
                  ? "Plano de contas global incompleto — configure antes de criar empresas"
                  : undefined
              }
            >
              Nova empresa
              {globalChartStatus && !globalChartStatus.isConfigured && (
                <span style={{ marginLeft: 6, fontSize: "0.7rem" }} aria-label="Plano global incompleto">⚠</span>
              )}
            </Button>
            {/* Q17: ordem — Nova empresa · Envio de e-mails · Apuração · Configurações */}
            {onOpenBatchEmail && (
              <Button variant="success" className="dashboard-home__action dashboard-home__action--success" onClick={onOpenBatchEmail}>
                Envio de e-mails em lote
              </Button>
            )}
            {onOpenApuracao && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenApuracao}>
                📊 Apuração
              </Button>
            )}
            {onOpenRotinas && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenRotinas}>
                🕒 Rotinas
              </Button>
            )}
            {onOpenPendencias && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenPendencias}>
                ⚠️ Pendências
              </Button>
            )}
            {onOpenSerproFuncoes && (
              <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenSerproFuncoes}>
                ⚙️ Funções em lote
              </Button>
            )}
            <SettingsMenu
              items={[
                { label: "Configuração SERPRO", onClick: onOpenGuideSettings },
                { label: "Plano de Contas Global", onClick: onOpenChartGlobal },
                { label: "Pendências (debug)", onClick: onOpenPendingReport },
              ]}
            />
            {/* Atualizar lista vira um ícone discreto */}
            <Button
              variant="secondary"
              className="dashboard-home__action"
              onClick={onRefreshCompanies}
              disabled={loadingCompanies}
              title="Atualizar lista"
              aria-label="Atualizar lista"
              style={{ minWidth: 40, padding: "8px 12px" }}
            >
              {loadingCompanies ? "…" : "↻"}
            </Button>
          </nav>

          <section
            aria-label="Filtros"
            style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 16 }}
          >
            <label style={{ ...FILTER_LABEL, flex: "1 1 220px", minWidth: 180 }}>
              Buscar empresa ou CNPJ
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ex.: Clinica ou 00.000.000/0001-00"
                style={{ ...FILTER_CONTROL, width: "100%" }}
              />
            </label>

            {/* C7: competência com setas ‹ › pra andar mês a mês (antes só o picker). */}
            {onChangeCompetencia && (
              <label style={FILTER_LABEL}>
                Competência
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => onChangeCompetencia(shiftCompetencia(dashboardCompetencia, -1))}
                    style={COMP_ARROW}
                    aria-label="Competência anterior"
                    title="Mês anterior"
                  >
                    ‹
                  </button>
                  <input
                    type="month"
                    value={dashboardCompetencia || ""}
                    onChange={(e) => onChangeCompetencia(e.target.value)}
                    style={{ ...FILTER_CONTROL, width: 150 }}
                  />
                  <button
                    type="button"
                    onClick={() => onChangeCompetencia(shiftCompetencia(dashboardCompetencia, 1))}
                    style={COMP_ARROW}
                    aria-label="Próxima competência"
                    title="Próximo mês"
                  >
                    ›
                  </button>
                </span>
              </label>
            )}

            {/* C7: os demais filtros saem da barra e vão pra um painel — o dono só quer
                busca e competência sempre visíveis. O badge mostra quantos estão ativos. */}
            <div style={{ position: "relative" }}>
              <Button
                type="button"
                variant={filtrosAtivos > 0 ? "primary" : "secondary"}
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
                title="Mais filtros"
              >
                Filtros{filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ""}
              </Button>
              {showFilters && (
                <div
                  style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30,
                    background: "#21222C", border: "1px solid #44475A", borderRadius: 10,
                    padding: 12, display: "grid", gap: 10, minWidth: 220,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                  }}
                >
                  <label style={FILTER_LABEL}>
                    Documentos
                    <select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="pending">Com pendências</option>
                      <option value="ok">Em dia</option>
                      <option value="all">Todas</option>
                    </select>
                  </label>

                  <label style={FILTER_LABEL}>
                    SERPRO
                    <select value={serproFilter} onChange={(event) => setSerproFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      <option value="eligible">Aptas</option>
                      <option value="ineligible">Não aptas</option>
                    </select>
                  </label>

                  <label style={FILTER_LABEL}>
                    Enviados
                    <select value={emailFilter} onChange={(event) => setEmailFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      <option value="sent">Só enviados</option>
                      <option value="notSent">Só não enviados</option>
                    </select>
                  </label>

                  <label style={FILTER_LABEL}>
                    Apuração
                    <select value={apuracaoFilter} onChange={(event) => setApuracaoFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      <option value="apurados">Apurados</option>
                      <option value="naoApurados">Não apurados</option>
                    </select>
                  </label>

                  <label style={FILTER_LABEL}>
                    Certificado
                    <select value={certFilter} onChange={(event) => setCertFilter(event.target.value)} style={{ ...FILTER_CONTROL, width: "100%" }}>
                      <option value="all">Todas</option>
                      <option value="comCert">Com certificado</option>
                      <option value="semCert">Sem certificado</option>
                    </select>
                  </label>

                  {filtrosAtivos > 0 && (
                    <Button type="button" variant="secondary" onClick={limparFiltros}>
                      Limpar filtros
                    </Button>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="cards-grid cards-grid--dashboard" aria-label="Lista de empresas">
            {filteredCompanies.map((company) => (
              <CompanyCard key={company.companyId} company={company} onAccess={onOpenCompany} />
            ))}
          </section>

          {!loadingCompanies && filteredCompanies.length === 0 ? (
            <p className="text-muted dashboard-home__empty">Nenhuma empresa encontrada para os filtros atuais.</p>
          ) : null}
        </section>

        <Feedback message={message} error={error} />
      </AppShell>
    </div>
  );
}
