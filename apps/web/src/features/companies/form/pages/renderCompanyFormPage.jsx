import { createApiClient } from "../../../../api/client";
import { useEmpresasDoResponsavel } from "../hooks/useEmpresasDoResponsavel";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { CompanyForm } from "../components/renderCompanyForm";

// ⚠ Instância de módulo, como em `renderCompanyDetailPage`: um cliente novo por render seria uma
// dependência instável no `useEffect` do hook, e a consulta refaria a cada tecla.
const responsavelApi = createApiClient();

export function CompanyFormPage({ form, onChange, onSubmit, submitting, onBack, error }) {
  // ⚠⚠ O AVISO PRECISA ESTAR AQUI, E ESTA É A TELA QUE MAIS IMPORTA. Medido: o `PATCH` NUNCA
  // conseguiu criar a conta compartilhada — ele recusa e-mail de outro usuário com
  // `owner_email_already_in_use`. Quem cria é o `POST /firm/companies`, que REUSA o `User` quando
  // o e-mail já existe (`CompanyProvisioningService`). Ou seja: é cadastrando empresa NOVA com um
  // e-mail já usado que nasce o login que enxerga N empresas — o defeito de 19/08/2026.
  // ⚠ AVISA, NÃO PROÍBE: grupo de empresas com o mesmo dono é legítimo, e o reuso da conta é o
  // comportamento pedido. O que não pode é a consequência ser invisível.
  // ⚠ Sem `empresaAtualId`: a empresa ainda não existe, então TODA empresa do e-mail é "outra".
  const empresasDoResponsavel = useEmpresasDoResponsavel({
    api: responsavelApi,
    email: form?.ownerEmail,
  });
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
            empresasDoResponsavel={empresasDoResponsavel}
          />
          <Feedback error={error} />
        </section>
      </AppShell>
    </PageShell>
  );
}
