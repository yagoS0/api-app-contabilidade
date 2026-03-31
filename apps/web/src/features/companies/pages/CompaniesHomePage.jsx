import { AppShell } from "../../../components/layout/AppShell";
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
  guideSettings,
  settingsLoading,
  jobEnabled,
  onToggleJob,
  cronTimeValue,
  setCronTimeValue,
  savingCron,
  onSaveCronSchedule,
  message,
  error,
}) {
  return (
    <AppShell>
      <header className="header inline-header">
        <div>
          <h1>Empresas</h1>
          <p>
            Usuario: <b>{user?.name || "FIRM"}</b> | Modo API: <b>{apiMode}</b>
          </p>
        </div>
        <div className="row-actions">
          <Button variant="secondary" onClick={onCreateCompany}>
            Nova empresa
          </Button>
          <Button variant="secondary" onClick={onOpenGuideSettings}>
            Configuração
          </Button>
          <Button variant="secondary" onClick={onOpenGuideUpload}>
            Upload de guias
          </Button>
          <Button variant="secondary" onClick={onRefreshCompanies} disabled={loadingCompanies}>
            Atualizar
          </Button>
          <Button variant="secondary" onClick={onOpenPendingReport}>
            Pendências de e-mail
          </Button>
          <Button variant="danger" onClick={onLogout}>
            Sair
          </Button>
        </div>
      </header>

      <section className="panel">
        <div className="inline-header">
          <h2>Ingestão de guias</h2>
          <div className="row-actions">
            <Button variant="secondary" onClick={onToggleJob}>
              Sobre o leitor de PDF
            </Button>
            <Button variant="secondary" onClick={onOpenGuideUpload}>
              Abrir upload de guias
            </Button>
          </div>
        </div>
        <p>
          Drive configurado:{" "}
          <b>{jobEnabled ? "pastas OK + pdf-reader na API" : "incompleto ou pdf-reader ausente"}</b>
        </p>
        <p className="hint">
          A leitura de PDF roda no serviço <code>pdf-reader</code> (variável <code>PDF_READER_URL</code> na API,
          rede interna). O portal só configura pastas do Drive e o cron.
        </p>
      </section>

      <section className="panel">
        <div className="inline-header">
          <h2>Agendamento automático</h2>
          <Button variant="secondary" onClick={onSaveCronSchedule} disabled={savingCron}>
            {savingCron ? "Salvando..." : "Salvar horário do cron"}
          </Button>
        </div>
        <label>
          Hora de execução diária
          <input type="time" value={cronTimeValue} onChange={(event) => setCronTimeValue(event.target.value)} />
        </label>
        <p className="hint">
          Deixe vazio e salve para desativar. Cron atual: <b>{guideSettings?.guideScheduleCron || "desativado"}</b>
        </p>
      </section>

      <section className="cards-grid">
        {companies.map((company) => (
          <CompanyCard key={company.companyId} company={company} onAccess={onOpenCompany} />
        ))}
      </section>

      {!loadingCompanies && companies.length === 0 ? (
        <section className="panel">
          <p>Nenhuma empresa encontrada.</p>
        </section>
      ) : null}

      <Feedback message={message} error={error} />
    </AppShell>
  );
}

