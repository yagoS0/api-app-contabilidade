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
  onOpenGuideSettings,
  onRefreshCompanies,
  onOpenPendingReport,
  onLogout,
  onOpenCompany,
  message,
  error,
}) {
  const [search, setSearch] = useState("");
  const [documentFilter, setDocumentFilter] = useState("pending");

  const filteredCompanies = useMemo(() => {
    const normalizedQuery = normalizeSearch(search);

    return companies.filter((company) => {
      const matchesSearch =
        !normalizedQuery ||
        normalizeSearch(company?.razao).includes(normalizedQuery) ||
        normalizeSearch(company?.cnpj).includes(normalizedQuery);

      if (!matchesSearch) return false;

      if (documentFilter === "pending") return hasPendingCompliance(company);
      if (documentFilter === "ok") return !hasPendingCompliance(company);
      return true;
    });
  }, [companies, documentFilter, search]);

  return (
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

        <nav className="dashboard-home__actions" aria-label="Atalhos">
          <Button variant="success" className="dashboard-home__action dashboard-home__action--success" onClick={onCreateCompany}>
            Nova empresa
          </Button>
          <Button variant="secondary" className="dashboard-home__action" onClick={onOpenGuideSettings}>
            Guias (Configuracoes)
          </Button>
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
          <Button variant="secondary" className="dashboard-home__action dashboard-home__action--accent" onClick={onOpenPendingReport}>
            Pendências de e-mail
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
  );
}
