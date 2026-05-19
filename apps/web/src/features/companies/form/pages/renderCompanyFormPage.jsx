import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { CompanyForm } from "../components/renderCompanyForm";

export function CompanyFormPage({ form, onChange, onSubmit, submitting, onBack, error }) {
  return (
    <PageShell
      title="Nova empresa"
      subtitle="Dados mínimos para cadastro e acesso ao portal"
      onBack={onBack}
    >
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
    </PageShell>
  );
}
