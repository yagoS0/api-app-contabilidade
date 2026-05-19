import { useEffect, useMemo } from "react";
import { createApiClient } from "./api/client";
import "./App.css";
import { CompaniesHomePage } from "./features/companies/list/pages/renderCompaniesHomePage";
import { CompanyFormPage } from "./features/companies/form/pages/renderCompanyFormPage";
import { CompanyDetailPage } from "./features/companies/detail/pages/renderCompanyDetailPage";
import { SerproSettingsPage } from "./features/fiscal/serpro/pages/renderSerproSettingsPage";
import { GuideUploadPage } from "./features/guides/upload/pages/renderGuideUploadPage";
import { LoginPage } from "./features/auth/login/pages/renderLoginPage";
import { PendingGuidesPage } from "./features/guides/pending/pages/renderPendingGuidesPage";
import { GlobalAccountingRulesPage } from "./features/accounting/rules/pages/renderGlobalAccountingRulesPage";
import { GlobalChartOfAccountsPage } from "./features/accounting/chart-of-accounts/pages/renderGlobalChartOfAccountsPage";
import { FirmSettingsHubPage } from "./features/firm/settings/pages/renderFirmSettingsHubPage";
import { useManageAppFeedback } from "./app/hooks/useManageAppFeedback";
import { useManageAuthSession } from "./app/hooks/useManageAuthSession";
import { useManageCompaniesWorkspace } from "./app/hooks/useManageCompaniesWorkspace";
import { useManageAccountingWorkspace } from "./app/hooks/useManageAccountingWorkspace";

const api = createApiClient();
const TOKEN_STORAGE_KEY = "portal_firm_access_token";

function App() {
  const feedback = useManageAppFeedback();
  const session = useManageAuthSession({ api, tokenStorageKey: TOKEN_STORAGE_KEY, feedback });
  const companiesWorkspace = useManageCompaniesWorkspace({
    api,
    page: session.page,
    setPage: session.setPage,
    feedback,
    onPgdasSynced: async (companyId, payload) => {
      if (session.page === "companyDetail" && companiesWorkspace.companiesState.selectedCompanyId === companyId) {
        const competencia = payload?.circular?.competencia || accountingWorkspace.circularCompetencia;
        await accountingWorkspace.loadCircular(accountingWorkspace.circularYear, competencia);
      }
    },
    onInssSynced: async (companyId, payload) => {
      if (session.page === "companyDetail" && companiesWorkspace.companiesState.selectedCompanyId === companyId) {
        const competencia = payload?.circular?.competencia || accountingWorkspace.circularCompetencia;
        await accountingWorkspace.loadCircular(accountingWorkspace.circularYear, competencia);
      }
    },
  });
  const accountingWorkspace = useManageAccountingWorkspace({
    api,
    page: session.page,
    selectedCompanyId: companiesWorkspace.companiesState.selectedCompanyId,
    companyDetailTab: companiesWorkspace.companyDetailTab,
    feedback,
  });

  const canEditCompany = useMemo(() => {
    const role = String(session.user?.role || "").toLowerCase();
    return role === "admin" || role === "contador";
  }, [session.user]);

  function handleLogout() {
    session.clearSession();
    companiesWorkspace.resetWorkspace();
    accountingWorkspace.resetWorkspace();
    feedback.clearFeedback();
  }

  useEffect(() => {
    api.setUnauthorizedHandler?.(() => {
      session.clearSession();
      companiesWorkspace.resetWorkspace();
      accountingWorkspace.resetWorkspace();
      feedback.setError("Sua sessão expirou. Faça login novamente.");
    });

    return () => {
      api.setUnauthorizedHandler?.(null);
    };
  }, [accountingWorkspace, companiesWorkspace, feedback, session]);

  if (session.page === "login") {
    return (
      <LoginPage
        apiMode={api.mode}
        identifier={session.loginIdentifier}
        password={session.loginPassword}
        onIdentifierChange={session.setLoginIdentifier}
        onPasswordChange={session.setLoginPassword}
        onSubmit={session.handleLogin}
        authLoading={session.authLoading}
        error={feedback.error}
      />
    );
  }

  if (session.page === "createCompany") {
    return (
      <CompanyFormPage
        form={companiesWorkspace.createCompanyForm.form}
        onChange={companiesWorkspace.createCompanyForm.setField}
        onSubmit={companiesWorkspace.handleCreateCompany}
        submitting={companiesWorkspace.submittingCompany}
        onBack={() => session.setPage("companies")}
        error={feedback.error}
      />
    );
  }

  if (session.page === "guideSettings") {
    return (
      <SerproSettingsPage
        settings={companiesWorkspace.guideSettings}
        companies={companiesWorkspace.companiesState.companies}
        selectedCompanyId={companiesWorkspace.companiesState.selectedCompanyId}
        saving={companiesWorkspace.savingSerproSettings}
        uploadingCertificate={companiesWorkspace.uploadingSerproCertificate}
        deletingCertificate={companiesWorkspace.deletingSerproCertificate}
        checkingProcuration={companiesWorkspace.checkingSerproProcuration}
        capturingPgdasd={companiesWorkspace.capturingSerproPgdasd}
        syncingPgdas={companiesWorkspace.syncingSerproPgdas}
        syncingInss={companiesWorkspace.syncingSerproInss}
        procurationStatus={companiesWorkspace.serproProcurationStatus}
        workerStatus={companiesWorkspace.serproWorkerStatus}
        onSave={companiesWorkspace.handleSaveSerproSettings}
        onUploadCertificate={companiesWorkspace.handleUploadSerproCertificate}
        onDeleteCertificate={companiesWorkspace.handleDeleteSerproCertificate}
        onLoadProcuration={companiesWorkspace.loadSerproCompanyProcuration}
        onCheckProcuration={companiesWorkspace.handleCheckSerproProcuration}
        onCapturePgdasd={companiesWorkspace.handleCaptureSerproPgdasd}
        onSyncPgdas={companiesWorkspace.handleSyncSerproPgdas}
        onSyncInss={companiesWorkspace.handleSyncSerproInss}
        onRefreshWorkerStatus={companiesWorkspace.loadSerproWorkerStatus}
        onRunCron={companiesWorkspace.handleRunSerproCron}
        runningCron={companiesWorkspace.runningSerproCron}
        cronRunResult={companiesWorkspace.serproCronRunResult}
        onBack={() => session.setPage("firmSettings")}
        message={feedback.message}
        error={feedback.error}
      />
    );
  }

  if (session.page === "firmSettings") {
    return (
      <FirmSettingsHubPage
        onBack={() => session.setPage("companies")}
        onOpen={(key) => {
          if (key === "guides") session.setPage("guideSettings");
          else if (key === "accountingRules") session.setPage("accountingRulesGlobal");
          else if (key === "chartOfAccounts") session.setPage("chartOfAccountsGlobal");
        }}
      />
    );
  }

  if (session.page === "chartOfAccountsGlobal") {
    return (
      <GlobalChartOfAccountsPage
        api={api}
        onBack={() => session.setPage("firmSettings")}
      />
    );
  }

  if (session.page === "accountingRulesGlobal") {
    return (
      <GlobalAccountingRulesPage
        api={api}
        onBack={() => session.setPage("firmSettings")}
      />
    );
  }

  if (session.page === "guideUpload") {
    return (
      <GuideUploadPage
        onBack={() => session.setPage("companies")}
        onUpload={companiesWorkspace.handleGuideUpload}
        uploading={companiesWorkspace.uploadingGuides}
        uploadResults={companiesWorkspace.uploadResults}
        unidentifiedGuides={companiesWorkspace.unidentifiedGuides}
        loadingUnidentifiedGuides={companiesWorkspace.loadingUnidentifiedGuides}
        onRefreshUnidentified={companiesWorkspace.loadUnidentifiedGuides}
        message={feedback.message}
        error={feedback.error}
      />
    );
  }

  if (session.page === "companyDetail") {
    return (
      <CompanyDetailPage
        company={{
          selectedCompany: companiesWorkspace.selectedCompany,
          onBack: () => session.setPage("companies"),
          companyDetailTab: companiesWorkspace.companyDetailTab,
          setCompanyDetailTab: companiesWorkspace.setCompanyDetailTab,
          canEditCompany,
        }}
        guidesPanel={{
          guides: companiesWorkspace.guidesState.guides,
          loading: companiesWorkspace.guidesState.loadingGuides,
          onRefresh: () => companiesWorkspace.loadGuides(),
          onResendGuide: companiesWorkspace.handleResendGuide,
          onConfirmGuidePayment: companiesWorkspace.handleConfirmGuidePayment,
          onRecalculateGuide: companiesWorkspace.handleRecalculateGuide,
          resendingGuideId: companiesWorkspace.guidesState.resendingGuideId,
          confirmingGuideId: companiesWorkspace.guidesState.confirmingGuideId,
          recalculatingGuideId: companiesWorkspace.guidesState.recalculatingGuideId,
          onUploadGuide: companiesWorkspace.handleCompanyGuideUpload,
          uploadingGuide: companiesWorkspace.uploadingCompanyGuide,
          onDeleteGuide: companiesWorkspace.handleDeleteGuide,
        }}
        editPanel={{
          form: companiesWorkspace.editCompanyForm.form,
          onChange: companiesWorkspace.editCompanyForm.setField,
          onSubmit: companiesWorkspace.handleUpdateCompany,
          submitting: companiesWorkspace.submittingCompanyEdit,
        }}
        accountingPanel={{
          entries: accountingWorkspace.accountingEntriesState.entries,
          total: accountingWorkspace.accountingEntriesState.total,
          loading: accountingWorkspace.accountingEntriesState.loading,
          filters: accountingWorkspace.accountingEntriesState.filters,
          onFilterChange: (key, value) => accountingWorkspace.accountingEntriesState.setFilter(key, value),
          onLoadEntries: () => accountingWorkspace.loadAccountingEntries(),
          onCreateEntry: accountingWorkspace.handleCreateEntry,
          onLoadPayrollTemplate: accountingWorkspace.handleLoadPayrollTemplate,
          onLoadBaixaTemplate: accountingWorkspace.handleLoadBaixaTemplate,
          api,
          onUpdateEntry: accountingWorkspace.handleUpdateEntry,
          onDeleteEntry: accountingWorkspace.handleDeleteEntry,
          onBulkDeleteEntries: accountingWorkspace.handleBulkDeleteEntries,
          onPreviewOFX: accountingWorkspace.handlePreviewOFX,
          onImportOFX: accountingWorkspace.handleImportOFX,
          onPreviewExcel: accountingWorkspace.handlePreviewExcel,
          onImportExcel: accountingWorkspace.handleImportExcel,
          savingEntry: accountingWorkspace.savingEntry,
          accounts: accountingWorkspace.chartOfAccountsState.accounts,
          onLoadAccounts: () => accountingWorkspace.loadChartOfAccounts(),
          onCreateAccount: accountingWorkspace.handleCreateAccount,
          onUpdateAccount: accountingWorkspace.handleUpdateAccount,
          onDeleteAccount: accountingWorkspace.handleDeleteAccount,
          onImportAccountsFile: accountingWorkspace.handleImportAccountsFile,
          onExportCsv: accountingWorkspace.handleExportEntriesCsv,
          onCreateBaixa: accountingWorkspace.handleCreateBaixa,
          savingBaixa: accountingWorkspace.savingBaixa,
          onSearchHistoricos: accountingWorkspace.searchHistoricos,
          onGetHistoricosByCode: accountingWorkspace.getHistoricosByCode,
          onLoadAllHistoricos: accountingWorkspace.loadAllHistoricos,
          onUpdateHistorico: accountingWorkspace.handleUpdateHistorico,
          onDeleteHistorico: accountingWorkspace.handleDeleteHistorico,
          message: accountingWorkspace.entriesMessage,
          error: accountingWorkspace.entriesError,
        }}
        circularPanel={{
          circularData: accountingWorkspace.circularData,
          loading: accountingWorkspace.loadingCircular,
          year: accountingWorkspace.circularYear,
          competencia: accountingWorkspace.circularCompetencia,
          onCompetenciaChange: accountingWorkspace.setCircularCompetencia,
          savingCircular: accountingWorkspace.savingCircular,
          approvingCircularEntryId: accountingWorkspace.approvingCircularEntryId,
          onYearChange: accountingWorkspace.handleCircularYearChange,
          onLoadCircular: accountingWorkspace.loadCircular,
          onSaveCircular: accountingWorkspace.handleSaveCircular,
          onApproveAccountingEntry: accountingWorkspace.handleApproveCircularEntry,
          runningFiscalAction: accountingWorkspace.runningFiscalAction,
          lastFiscalResult: accountingWorkspace.lastFiscalResult,
          onSearchGuides: accountingWorkspace.handleSearchGuides,
          onCheckPayments: accountingWorkspace.handleCheckPayments,
          onSyncInss: accountingWorkspace.handleSyncInss,
          executions: accountingWorkspace.fiscalExecutions,
          loadingExecutions: accountingWorkspace.loadingFiscalExecutions,
          error: accountingWorkspace.entriesError,
          message: accountingWorkspace.entriesMessage,
          onCancelBaixa: accountingWorkspace.handleDeleteEntryNoConfirm,
        }}
        feedback={{ message: feedback.message, error: feedback.error }}
      />
    );
  }

  if (session.page === "pendingReport") {
    return (
      <PendingGuidesPage
        guides={companiesWorkspace.pendingGuides}
        loading={companiesWorkspace.loadingPendingGuides}
        selectedIds={companiesWorkspace.selectedPendingGuideIds}
        onToggle={companiesWorkspace.togglePendingGuideSelection}
        onToggleAll={companiesWorkspace.toggleAllPendingGuides}
        onSendSelected={companiesWorkspace.handleSendSelectedPending}
        sending={companiesWorkspace.sendingSelectedPending}
        onRefresh={companiesWorkspace.loadPendingGuidesReport}
        onBack={() => session.setPage("companies")}
        message={feedback.message}
        error={feedback.error}
      />
    );
  }

  return (
    <CompaniesHomePage
      user={session.user}
      apiMode={api.mode}
      companies={companiesWorkspace.companiesState.companies}
      loadingCompanies={companiesWorkspace.companiesState.loadingCompanies}
      onCreateCompany={() => session.setPage("createCompany")}
      onOpenGuideUpload={() => session.setPage("guideUpload")}
      onOpenFirmSettings={() => session.setPage("firmSettings")}
      onRefreshCompanies={companiesWorkspace.loadCompanies}
      onOpenPendingReport={() => session.setPage("pendingReport")}
      onLogout={handleLogout}
      onOpenCompany={(companyId) => {
        companiesWorkspace.companiesState.setSelectedCompanyId(companyId);
        session.setPage("companyDetail");
      }}
      jobEnabled={companiesWorkspace.jobEnabled}
      onToggleJob={companiesWorkspace.handleToggleJob}
      message={feedback.message}
      error={feedback.error}
    />
  );
}

export default App;
