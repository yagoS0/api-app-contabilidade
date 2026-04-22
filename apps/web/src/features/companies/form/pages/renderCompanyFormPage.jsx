import { AppShell } from "../../../../components/layout/AppShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { CompanyForm } from "../components/renderCompanyForm";

export function CompanyFormPage({ form, onChange, onSubmit, submitting, onBack, error }) {
  return (
    <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
      <header className="company-section-header">
        <div className="company-section-header__brand">
          <button type="button" className="company-section-header__back" onClick={onBack}>
            Voltar
          </button>

          <div className="company-section-header__company">
            <strong className="company-section-header__company-name">Nova empresa</strong>
            <span className="company-section-header__company-meta">Dados mínimos para cadastro e acesso ao portal</span>
          </div>
        </div>
      </header>

      <AppShell className="company-form-page-shell">
        <section className="company-form-page__panel">
          <div className="company-form-page__intro">
            <h1 className="company-form-page__title">Cadastro de empresa</h1>
            <p className="company-form-page__description">
              Preencha os dados principais para liberar o acesso da empresa ao portal.
            </p>
          </div>

          <CompanyForm
            form={form}
            onChange={onChange}
            onSubmit={onSubmit}
            submitting={submitting}
            submitLabel="Cadastrar empresa"
            showOwnerPassword
          />
          <Feedback error={error} />
        </section>
      </AppShell>
    </div>
  );
}
