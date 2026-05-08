import { AppShell } from "../../../../components/layout/AppShell";
import { CompanySectionHeader } from "../components/renderCompanyDetailHeader";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { CompanyGuidesTable } from "../../../guides/list/components/renderCompanyGuidesTable";
import { CompanyForm } from "../../form/components/renderCompanyForm";
import { AccountingEntriesTab } from "../../../accounting/entries/components/renderAccountingEntriesTab";
import { CircularTab } from "../../../accounting/circular/components/renderCircularTab";
import { AccountingRulesContainer } from "../../../accounting/rules/components/renderAccountingRulesContainer";
import { ChartOfAccountsPage } from "../../../accounting/chart-of-accounts/pages/renderChartOfAccountsPage";

export function CompanyDetailPage({ company, guidesPanel, editPanel, accountingPanel, circularPanel, feedback }) {
  const { selectedCompany, canEditCompany, companyDetailTab, setCompanyDetailTab, onBack } = company;
  const companyId = selectedCompany?.companyId;

  function switchTab(tab) {
    setCompanyDetailTab(tab);
    if (tab === "lancamentos") { accountingPanel.onLoadAccounts(); accountingPanel.onLoadEntries(); }
    if (tab === "circular") { accountingPanel.onLoadAccounts(); circularPanel.onLoadCircular(); }
    if (tab === "configuracoes") { accountingPanel.onLoadAccounts(); }
    if (tab === "planoContas") { accountingPanel.onLoadAccounts(); }
  }

  // ─── Aba Lançamentos: layout full-screen com barra de topo compacta ────────

  if (companyDetailTab === "lancamentos") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="lancamentos"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />

        {/* Conteúdo full-width — sem restrição de max-width */}
        <div style={{ flex: 1 }}>
          <AccountingEntriesTab
            companyId={companyId}
            entries={accountingPanel.entries}
            total={accountingPanel.total}
            loading={accountingPanel.loading}
            filters={accountingPanel.filters}
            onFilterChange={accountingPanel.onFilterChange}
            onLoad={accountingPanel.onLoadEntries}
            onCreateEntry={accountingPanel.onCreateEntry}
            onLoadPayrollTemplate={accountingPanel.onLoadPayrollTemplate}
            onUpdateEntry={accountingPanel.onUpdateEntry}
            onDeleteEntry={accountingPanel.onDeleteEntry}
            onBulkDeleteEntries={accountingPanel.onBulkDeleteEntries}
            onPreviewOFX={accountingPanel.onPreviewOFX}
            onImportOFX={accountingPanel.onImportOFX}
            savingEntry={accountingPanel.savingEntry}
            accounts={accountingPanel.accounts}
            onLoadAccounts={accountingPanel.onLoadAccounts}
            onCreateAccount={accountingPanel.onCreateAccount}
            onUpdateAccount={accountingPanel.onUpdateAccount}
            onDeleteAccount={accountingPanel.onDeleteAccount}
            onImportAccountsFile={accountingPanel.onImportAccountsFile}
            onOpenChartOfAccountsTab={() => switchTab("planoContas")}
            onExportCsv={accountingPanel.onExportCsv}
            onCreateBaixa={accountingPanel.onCreateBaixa}
            savingBaixa={accountingPanel.savingBaixa}
            onLoadBaixaTemplate={accountingPanel.onLoadBaixaTemplate}
            onSearchHistoricos={accountingPanel.onSearchHistoricos}
            onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
            onLoadAllHistoricos={accountingPanel.onLoadAllHistoricos}
            onUpdateHistorico={accountingPanel.onUpdateHistorico}
            onDeleteHistorico={accountingPanel.onDeleteHistorico}
            message={accountingPanel.message}
            error={accountingPanel.error}
          />
        </div>
      </div>
    );
  }

  if (companyDetailTab === "guides") {
      return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="guides"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />

        <AppShell className="guides-page-shell">
          <CompanyGuidesTable
            guides={guidesPanel.guides}
            loadingGuides={guidesPanel.loading}
            onResendGuide={guidesPanel.onResendGuide}
            onConfirmGuidePayment={guidesPanel.onConfirmGuidePayment}
            onDeleteGuide={guidesPanel.onDeleteGuide}
            onRecalculateGuide={guidesPanel.onRecalculateGuide}
            resendingGuideId={guidesPanel.resendingGuideId}
            confirmingGuideId={guidesPanel.confirmingGuideId}
            recalculatingGuideId={guidesPanel.recalculatingGuideId}
            onUploadGuide={guidesPanel.onUploadGuide}
            uploadingGuide={guidesPanel.uploadingGuide}
          />

          <Feedback message={feedback.message} error={feedback.error} />
        </AppShell>
      </div>
    );
  }

  if (companyDetailTab === "planoContas") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="planoContas"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />
        <div style={{ flex: 1 }}>
          <ChartOfAccountsPage
            accounts={accountingPanel.accounts || []}
            onCreateAccount={accountingPanel.onCreateAccount}
            onUpdateAccount={accountingPanel.onUpdateAccount}
            onDeleteAccount={accountingPanel.onDeleteAccount}
            onImportFile={accountingPanel.onImportAccountsFile}
            onBack={() => switchTab("lancamentos")}
          />
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  if (companyDetailTab === "configuracoes") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="configuracoes"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />
        <AppShell>
          <AccountingRulesContainer
            api={accountingPanel.api}
            scope="COMPANY"
            companyId={companyId}
            accounts={accountingPanel.accounts || []}
            onOpenChartOfAccounts={() => switchTab("planoContas")}
          />
          <Feedback message={feedback.message} error={feedback.error} />
        </AppShell>
      </div>
    );
  }

  if (companyDetailTab === "edit") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="edit"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />

        <AppShell className="company-form-page-shell">
          <section className="company-form-page__panel">
            <div className="company-form-page__intro">
              <h1 className="company-form-page__title">Editar cadastro</h1>
              <p className="company-form-page__description">
                Atualize os dados cadastrais da empresa no mesmo padrão visual das demais telas.
              </p>
            </div>

            {!canEditCompany ? (
              <p className="text-muted">Apenas admin ou contador pode alterar os dados.</p>
            ) : (
              <CompanyForm
                form={editPanel.form}
                onChange={editPanel.onChange}
                onSubmit={editPanel.onSubmit}
                submitting={editPanel.submitting}
                submitLabel="Salvar alterações"
                showOwnerPassword={false}
              />
            )}

            <Feedback message={feedback.message} error={feedback.error} />
          </section>
        </AppShell>
      </div>
    );
  }

  // ─── Aba Circular: layout full-screen ────────────────────────────────────────

  if (companyDetailTab === "circular") {
    return (
      <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="circular"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />

        <div style={{ flex: 1 }}>
          <CircularTab
            circularData={circularPanel.circularData}
            loading={circularPanel.loading}
            year={circularPanel.year}
            competencia={circularPanel.competencia}
            onCompetenciaChange={circularPanel.onCompetenciaChange}
            onYearChange={circularPanel.onYearChange}
            onLoad={circularPanel.onLoadCircular}
            accounts={accountingPanel.accounts}
            onCreateBaixa={accountingPanel.onCreateBaixa}
            savingBaixa={accountingPanel.savingBaixa}
            onLoadBaixaTemplate={accountingPanel.onLoadBaixaTemplate}
            runningFiscalAction={circularPanel.runningFiscalAction}
            lastFiscalResult={circularPanel.lastFiscalResult}
            onSearchGuides={circularPanel.onSearchGuides}
            onCheckPayments={circularPanel.onCheckPayments}
            onSyncInss={circularPanel.onSyncInss}
            executions={circularPanel.executions}
            loadingExecutions={circularPanel.loadingExecutions}
            error={circularPanel.error}
            message={circularPanel.message}
            onUpdateEntry={accountingPanel.onUpdateEntry}
            onSearchHistoricos={accountingPanel.onSearchHistoricos}
            onCancelBaixa={circularPanel.onCancelBaixa}
          />
        </div>
      </div>
    );
  }

  // ─── Demais abas: layout padrão ────────────────────────────────────────────

  return (
    <AppShell>
      <PageHeader
          title={selectedCompany?.razao || "Empresa"}
          description="Dados cadastrais, guias e lançamentos contábeis."
          actions={<Button variant="secondary" onClick={onBack}>Voltar</Button>}
      />

      {selectedCompany && (
        <section className="panel">
          <div className="company-card">
            <p><span className="text-muted">CNPJ:</span> {selectedCompany.cnpj}</p>
            <p><span className="text-muted">E-mail do responsável:</span> {selectedCompany.ownerEmail || selectedCompany.email || "—"}</p>
            <p><span className="text-muted">E-mail das guias:</span> {selectedCompany.guideNotificationEmail || "—"}</p>
            <p><span className="text-muted">Pró-labore:</span> {selectedCompany.hasProlabore ? "Sim" : "Não"}</p>
            <p><span className="text-muted">Município / UF:</span> {selectedCompany.municipio || "—"} / {selectedCompany.uf || "—"}</p>
          </div>
          <div className="toolbar">
            <Button variant="secondary" type="button"
              onClick={() => switchTab("guides")}
              disabled={companyDetailTab === "guides"}>
              Guias
            </Button>
            <Button variant="secondary" type="button"
              onClick={() => switchTab("lancamentos")}>
              Lançamentos
            </Button>
            <Button variant="secondary" type="button"
              onClick={() => switchTab("circular")}>
              Circular
            </Button>
            <Button variant="secondary" type="button"
              onClick={() => switchTab("edit")}
              disabled={!canEditCompany || companyDetailTab === "edit"}
              title={!canEditCompany ? "Apenas admin ou contador pode editar." : undefined}>
              Editar cadastro
            </Button>
          </div>
        </section>
      )}

      {companyDetailTab === "guides" && (
          <CompanyGuidesTable guides={guidesPanel.guides} loadingGuides={guidesPanel.loading} onRefresh={guidesPanel.onRefresh} onResendGuide={guidesPanel.onResendGuide} onConfirmGuidePayment={guidesPanel.onConfirmGuidePayment} onRecalculateGuide={guidesPanel.onRecalculateGuide} resendingGuideId={guidesPanel.resendingGuideId} confirmingGuideId={guidesPanel.confirmingGuideId} recalculatingGuideId={guidesPanel.recalculatingGuideId} />
        )}

      <Feedback message={feedback.message} error={feedback.error} />
    </AppShell>
  );
}
