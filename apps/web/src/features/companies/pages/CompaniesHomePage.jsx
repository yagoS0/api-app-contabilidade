import { AppShell } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Feedback } from "../../../components/ui/Feedback";
import { Button } from "../../../components/ui/Button";
import { CompanyCard } from "../components/CompanyCard";

export function CompaniesHomePage({
  user,
  apiMode,
  companies,
  loadingCompanies,
  onCreateCompany,
  onOpenGuideUpload,
  onOpenGuideSettings,
  onRefreshCompanies,
  onOpenPendingReport,
  onLogout,
  onOpenCompany,
  jobEnabled,
  onToggleJob,
  message,
  error,
}) {
  return (
    <AppShell>
      <PageHeader
        title="Empresas"
        description={`${user?.name || "Conta escritório"} · API: ${apiMode}`}
        actions={
          <Button variant="danger" onClick={onLogout}>
            Sair
          </Button>
        }
      />

      <nav className="panel" aria-label="Atalhos">
        <div className="toolbar">
          <Button variant="secondary" onClick={onCreateCompany}>
            Nova empresa
          </Button>
          <Button variant="secondary" onClick={onOpenGuideSettings}>
            Guias — configuração
          </Button>
          <Button variant="secondary" onClick={onOpenGuideUpload}>
            Guias — upload
          </Button>
          <Button variant="secondary" onClick={onRefreshCompanies} disabled={loadingCompanies}>
            {loadingCompanies ? "Atualizando…" : "Atualizar lista"}
          </Button>
          <Button variant="secondary" onClick={onOpenPendingReport}>
            Pendências de e-mail
          </Button>
        </div>
      </nav>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Processamento de PDF</h2>
          <Button variant="secondary" size="sm" type="button" onClick={onToggleJob}>
            Como funciona
          </Button>
        </div>
        <p className="status-line">
          Serviço <code className="code-inline">pdf-reader</code> na API:
          <span className={jobEnabled ? "status-chip status-chip--ok" : "status-chip status-chip--off"}>
            {jobEnabled ? "Configurado" : "Não configurado"}
          </span>
        </p>
        <p className="hint" style={{ marginTop: "var(--space-2)" }}>
          Envie PDFs em <b>Guias — upload</b>. O arquivo é guardado no banco após o processamento.
        </p>
      </section>

      <section className="cards-grid" aria-label="Lista de empresas">
        {companies.map((company) => (
          <CompanyCard key={company.companyId} company={company} onAccess={onOpenCompany} />
        ))}
      </section>

      {!loadingCompanies && companies.length === 0 ? (
        <p className="text-muted">Nenhuma empresa na carteira.</p>
      ) : null}

      <Feedback message={message} error={error} />
    </AppShell>
  );
}
