import { AppShell } from "../../../components/layout/AppShell";
import { Feedback } from "../../../components/ui/Feedback";
import { Button } from "../../../components/ui/Button";
import { CompanyForm } from "../components/CompanyForm";

export function CompanyFormPage({ form, onChange, onSubmit, submitting, onBack, error }) {
  return (
    <AppShell>
      <header className="header inline-header">
        <div>
          <h1>Nova empresa</h1>
          <p>Preencha os dados minimos para cadastro.</p>
        </div>
        <Button variant="secondary" onClick={onBack}>
          Voltar
        </Button>
      </header>
      <section className="panel">
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
  );
}

