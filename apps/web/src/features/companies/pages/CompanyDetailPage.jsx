import { AppShell } from "../../../components/layout/AppShell";
import { PageHeader } from "../../../components/layout/PageHeader";
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
      <PageHeader
        title={selectedCompany?.razao || "Empresa"}
        description="Dados cadastrais e guias processadas."
        actions={
          <Button variant="secondary" onClick={onBack}>
            Voltar
          </Button>
        }
      />

      {selectedCompany ? (
        <section className="panel">
          <div className="company-card">
            <p>
              <span className="text-muted">CNPJ:</span> {selectedCompany.cnpj}
            </p>
            <p>
              <span className="text-muted">E-mail do responsável:</span>{" "}
              {selectedCompany.ownerEmail || selectedCompany.email || "—"}
            </p>
            <p>
              <span className="text-muted">E-mail das guias:</span>{" "}
              {selectedCompany.guideNotificationEmail || "—"}
            </p>
            <p>
              <span className="text-muted">Município / UF:</span> {selectedCompany.municipio || "—"} /{" "}
              {selectedCompany.uf || "—"}
            </p>
          </div>
          <div className="toolbar">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setCompanyDetailTab("guides")}
              disabled={companyDetailTab === "guides"}
            >
              Guias
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setCompanyDetailTab("edit")}
              disabled={!canEditCompany || companyDetailTab === "edit"}
              title={!canEditCompany ? "Apenas admin ou contador pode editar." : undefined}
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
          <h2 className="panel__title">Editar cadastro</h2>
          {!canEditCompany ? (
            <p className="text-muted">Apenas admin ou contador pode alterar os dados.</p>
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
