import { useMemo, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { CompanyCard, getComplianceTags } from "../components/renderCompanyCard";

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasPendingCompliance(company) {
  return getComplianceTags(company?.guideCompliance).some((tag) => !tag.ok);
}

export function CompaniesHomePage({
  user,
  companies,
  loadingCompanies,
  onCreateCompany,
  onOpenGuideUpload,
  onOpenFirmSettings,
  onRefreshCompanies,
  onOpenPendingReport,
  onOpenBatchEmail,
  onOpenApuracao,
  onLogout,
  onOpenCompany,
  globalChartStatus, // { isConfigured, tiposFaltantes, ... } — pré-requisito para criar empresa
  message,
  error,
}) {
  const [search, setSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState("pending");
  const [serproFilter, setSerproFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("all"); // all | notSent (Q16)

  const filteredCompanies = useMemo(() => {
    const normalizedQuery = normalizeSearch(search);

    // 1) Busca por nome/CNPJ continua filtrando (remove quem não bate).
    //    Q16: filtro "Só não enviados" também REMOVE quem já teve o e-mail do mês enviado.
    const searched = companies.filter((company) => {
      if (emailFilter === "notSent" && company?.monthEmailSent) return false;
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
  }, [companies, documentFilter, search, serproFilter]);

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
              {onOpenFirmSettings && (
                <Button variant="secondary" onClick={onOpenFirmSettings}>
                  Abrir Configurações
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
            {onOpenFirmSettings && (
              <Button variant="secondary" className="dashboard-home__action" onClick={onOpenFirmSettings}>
                Configurações
              </Button>
            )}
            <Button variant="secondary" className="dashboard-home__action" onClick={onOpenGuideUpload}>
              Guias (Upload)
            </Button>
            <Button
              variant="secondary"
              className="dashboard-home__action"
              onClick={onRefreshCompanies}
              disabled={loadingCompanies}
            >
              {loadingCompanies ? "Atualizando…" : "Atualizar lista"}
            </Button>
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
            <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenPendingReport}>
              Pendências (debug)
            </Button>
          </nav>

          <section className="dashboard-home__filters" aria-label="Filtros">
            <label className="dashboard-filter-field dashboard-filter-field--search">
              <span>Buscar empresa ou CNPJ</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ex.: Clinica ou 00.000.000/0001-00"
              />
            </label>

            <label className="dashboard-filter-field dashboard-filter-field--select">
              <span>Filtro de documentos</span>
              <select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)}>
                <option value="pending">Empresas com pendencias</option>
                <option value="ok">Empresas em dia</option>
                <option value="all">Todas as empresas</option>
              </select>
            </label>

            <label className="dashboard-filter-field dashboard-filter-field--select">
              <span>Filtro SERPRO</span>
              <select value={serproFilter} onChange={(event) => setSerproFilter(event.target.value)}>
                <option value="all">Todas</option>
                <option value="eligible">SERPRO aptas</option>
                <option value="ineligible">SERPRO não aptas</option>
              </select>
            </label>

            <label className="dashboard-filter-field dashboard-filter-field--select">
              <span>E-mail do mês</span>
              <select value={emailFilter} onChange={(event) => setEmailFilter(event.target.value)}>
                <option value="all">Todas</option>
                <option value="notSent">Só não enviados</option>
              </select>
            </label>
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
