import { AppShell } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Feedback } from "../../../components/ui/Feedback";
import { Button } from "../../../components/ui/Button";
import { CompanyForm } from "../components/CompanyForm";

export function CompanyFormPage({ form, onChange, onSubmit, submitting, onBack, error }) {
  return (
    <AppShell>
      <PageHeader
        title="Nova empresa"
        description="Dados mínimos para cadastro e acesso ao portal."
        actions={
          <Button variant="secondary" onClick={onBack}>
            Voltar
          </Button>
        }
      />
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
