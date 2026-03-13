import { AppShell } from "../../../components/layout/AppShell";
import { Feedback } from "../../../components/ui/Feedback";
import { Button } from "../../../components/ui/Button";
import { CompanyGuidesTable } from "../components/CompanyGuidesTable";
import { CompanyForm } from "../components/CompanyForm";

export function CompanyDetailPage({
  selectedCompany,
  onBack,
  companyDetailTab,
  setCompanyDetailTab,
  canEditCompany,
  guides,
  loadingGuides,
  onRefreshGuides,
  onResendGuide,
  resendingGuideId,
  companyEditForm,
  onEditFormChange,
  onUpdateCompany,
  submittingCompanyEdit,
  message,
  error,
}) {
  return (
    <AppShell>
      <header className="header inline-header">
        <div>
          <h1>Empresa</h1>
          <p>Dados da empresa e guias processadas.</p>
        </div>
        <Button variant="secondary" onClick={onBack}>
          Voltar
        </Button>
      </header>

      {selectedCompany ? (
        <section className="panel">
          <div className="company-card">
            <p>
              <b>Razao social:</b> {selectedCompany.razao}
            </p>
            <p>
              <b>CNPJ:</b> {selectedCompany.cnpj}
            </p>
            <p>
              <b>Email:</b> {selectedCompany.email || "-"}
            </p>
            <p>
              <b>Municipio/UF:</b> {selectedCompany.municipio || "-"} / {selectedCompany.uf || "-"}
            </p>
          </div>
          <div className="row-actions">
            <Button
              variant="secondary"
              onClick={() => setCompanyDetailTab("guides")}
              disabled={companyDetailTab === "guides"}
            >
              Guias
            </Button>
            <Button
              variant="secondary"
              onClick={() => setCompanyDetailTab("edit")}
              disabled={!canEditCompany || companyDetailTab === "edit"}
              title={!canEditCompany ? "Apenas admin/contador pode editar cadastro." : ""}
            >
              Editar cadastro
            </Button>
          </div>
        </section>
      ) : null}

      {companyDetailTab === "guides" ? (
        <CompanyGuidesTable
          guides={guides}
          loadingGuides={loadingGuides}
          onRefresh={onRefreshGuides}
          onResendGuide={onResendGuide}
          resendingGuideId={resendingGuideId}
        />
      ) : (
        <section className="panel">
          <div className="inline-header">
            <h2>Editar cadastro</h2>
          </div>
          {!canEditCompany ? (
            <p className="hint">Apenas perfis admin/contador podem editar os dados da empresa.</p>
          ) : (
            <CompanyForm
              form={companyEditForm}
              onChange={onEditFormChange}
              onSubmit={onUpdateCompany}
              submitting={submittingCompanyEdit}
              submitLabel="Salvar alterações"
              showOwnerPassword={false}
            />
          )}
        </section>
      )}

      <Feedback message={message} error={error} />
    </AppShell>
  );
}

