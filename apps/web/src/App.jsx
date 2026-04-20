import { useMemo } from "react";
import { createApiClient } from "./api/client";
import "./App.css";
import { CompaniesHomePage } from "./features/companies/list/pages/renderCompaniesHomePage";
import { CompanyFormPage } from "./features/companies/form/pages/renderCompanyFormPage";
import { CompanyDetailPage } from "./features/companies/detail/pages/renderCompanyDetailPage";
import { GuideSettingsPage } from "./features/guides/settings/pages/renderGuideSettingsPage";
import { GuideUploadPage } from "./features/guides/upload/pages/renderGuideUploadPage";
import { LoginPage } from "./features/auth/login/pages/renderLoginPage";
import { PendingGuidesPage } from "./features/guides/pending/pages/renderPendingGuidesPage";
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
      <GuideSettingsPage
        pdfReaderConfigured={Boolean(companiesWorkspace.guideSettings?.pdfReaderConfigured)}
        onBack={() => session.setPage("companies")}
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
          resendingGuideId: companiesWorkspace.guidesState.resendingGuideId,
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
          onUpdateEntry: accountingWorkspace.handleUpdateEntry,
          onDeleteEntry: accountingWorkspace.handleDeleteEntry,
          onPreviewOFX: accountingWorkspace.handlePreviewOFX,
          onImportOFX: accountingWorkspace.handleImportOFX,
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
          onYearChange: accountingWorkspace.handleCircularYearChange,
          onLoadCircular: accountingWorkspace.loadCircular,
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
      onOpenGuideSettings={() => session.setPage("guideSettings")}
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
