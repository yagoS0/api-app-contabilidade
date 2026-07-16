import { useEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { createApiClient } from "./api/client";
import "./App.css";
import { CompaniesHomePage } from "./features/companies/list/pages/renderCompaniesHomePage";
import { CompanyFormPage } from "./features/companies/form/pages/renderCompanyFormPage";
import { CompanyDetailPage } from "./features/companies/detail/pages/renderCompanyDetailPage";
import { SerproSettingsPage } from "./features/fiscal/serpro/pages/renderSerproSettingsPage";
import { SerproFuncoesPage } from "./features/fiscal/serpro/pages/renderSerproFuncoesPage";
import { RotinasPage } from "./features/fiscal/rotinas/pages/renderRotinasPage";
import { GuideUploadPage } from "./features/guides/upload/pages/renderGuideUploadPage";
import { LoginPage } from "./features/auth/login/pages/renderLoginPage";
import { PendingGuidesPage } from "./features/guides/pending/pages/renderPendingGuidesPage";
import { BatchEmailPage } from "./features/guides/batch-email/pages/renderBatchEmailPage";
import { GlobalChartOfAccountsPage } from "./features/accounting/chart-of-accounts/pages/renderGlobalChartOfAccountsPage";
import { useManageAppFeedback } from "./app/hooks/useManageAppFeedback";
import { useManageAuthSession } from "./app/hooks/useManageAuthSession";
import { useManageCompaniesWorkspace } from "./app/hooks/useManageCompaniesWorkspace";
import { useManageAccountingWorkspace } from "./app/hooks/useManageAccountingWorkspace";
import { useAccountingFunctions } from "./features/accounting/functions/hooks/useAccountingFunctions";
import { useParcelamentos } from "./features/accounting/parcelamento/hooks/useParcelamentos";
import { useNotasFiscais } from "./features/notas/hooks/useNotasFiscais";
import { useApuracao } from "./features/apuracao/hooks/useApuracao";
import { ApuracaoPage } from "./features/apuracao/pages/renderApuracaoPage";
import { usePendencias } from "./features/pendencias/hooks/usePendencias";
import { PendenciasPage } from "./features/pendencias/pages/renderPendenciasPage";

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
  // Q6: Funções de Lançamento — escopo da empresa selecionada
  const accountingFunctions = useAccountingFunctions({
    api,
    companyId: companiesWorkspace.companiesState.selectedCompanyId,
  });
  // Q9: Parcelamentos — escopo da empresa selecionada
  const parcelamentos = useParcelamentos({
    api,
    companyId: companiesWorkspace.companiesState.selectedCompanyId,
  });
  // Q12.A: Notas Fiscais — escopo da empresa selecionada (carrega só quando há companyId)
  const notasFiscais = useNotasFiscais({
    api,
    companyId: companiesWorkspace.companiesState.selectedCompanyId,
    feedback,
  });
  // Q12.C.2: Apuração global — só carrega depois de autenticado e na página apuracao
  // (evita 401 fantasma quando App monta antes do login).
  const apuracao = useApuracao({
    api,
    feedback,
    enabled: Boolean(session.user) && session.page === "apuracao",
  });

  // Q41: página Pendências (situação fiscal / SITFIS) — carrega só quando na página.
  const pendenciasFiscais = usePendencias({
    api,
    feedback,
    enabled: Boolean(session.user) && session.page === "pendencias",
  });

  // Q8.C: sincroniza selectedCompanyId com a URL (/companies/:companyId/*).
  // Necessário pra deep-link funcionar: usuário cola URL com companyId → state interno
  // adota essa empresa. Também garante "voltar" preserva contexto.
  const location = useLocation();
  useEffect(() => {
    const match = location.pathname.match(/^\/companies\/([^\/]+)(\/|$)/);
    if (match && match[1] !== "new") {
      const companyIdFromUrl = decodeURIComponent(match[1]);
      if (companyIdFromUrl !== companiesWorkspace.companiesState.selectedCompanyId) {
        companiesWorkspace.companiesState.setSelectedCompanyId(companyIdFromUrl);
      }
    }
  }, [location.pathname, companiesWorkspace.companiesState]);

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
        onRunOp={companiesWorkspace.runSerproOp}
        onRefreshWorkerStatus={companiesWorkspace.loadSerproWorkerStatus}
        onRunCron={companiesWorkspace.handleRunSerproCron}
        runningCron={companiesWorkspace.runningSerproCron}
        cronRunResult={companiesWorkspace.serproCronRunResult}
        onBack={() => session.setPage("companies")}
        message={feedback.message}
        error={feedback.error}
      />
    );
  }

  if (session.page === "chartOfAccountsGlobal") {
    return (
      <GlobalChartOfAccountsPage
        api={api}
        onBack={() => session.setPage("companies")}
      />
    );
  }

  if (session.page === "apuracao") {
    return (
      <ApuracaoPage
        apuracaoPanel={apuracao}
        apuracaoApi={api}
        feedback={feedback}
        onBack={() => session.setPage("companies")}
        onOpenCompanyNotas={(pcId) => {
          companiesWorkspace.companiesState.setSelectedCompanyId(pcId);
          session.setPage("companyDetail");
          companiesWorkspace.setCompanyDetailTab("notasFiscais");
        }}
      />
    );
  }

  if (session.page === "pendencias") {
    return (
      <PendenciasPage
        pendenciasPanel={pendenciasFiscais}
        onBack={() => session.setPage("companies")}
      />
    );
  }

  if (session.page === "serproFuncoes") {
    return (
      <SerproFuncoesPage
        api={api}
        settings={companiesWorkspace.guideSettings}
        companies={companiesWorkspace.companiesState.companies}
        onRunOp={companiesWorkspace.runSerproOp}
        onBack={() => session.setPage("companies")}
        message={feedback.message}
        error={feedback.error}
      />
    );
  }

  if (session.page === "rotinas") {
    return (
      <RotinasPage
        api={api}
        workerStatus={companiesWorkspace.serproWorkerStatus}
        onRunCron={companiesWorkspace.handleRunSerproCron}
        runningCron={companiesWorkspace.runningSerproCron}
        onRefreshWorkerStatus={companiesWorkspace.loadSerproWorkerStatus}
        onRunPaymentConfirmation={() => api.runSerproPaymentConfirmation({})}
        onBack={() => session.setPage("companies")}
        message={feedback.message}
        error={feedback.error}
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
          onRecalcularInss: companiesWorkspace.handleRecalcularInss,
          recalcInssBusy: companiesWorkspace.recalcInssBusy,
          onLiberarGuias: companiesWorkspace.handleLiberarGuias,
          liberarGuiasBusy: companiesWorkspace.liberarGuiasBusy,
          resendingGuideId: companiesWorkspace.guidesState.resendingGuideId,
          confirmingGuideId: companiesWorkspace.guidesState.confirmingGuideId,
          recalculatingGuideId: companiesWorkspace.guidesState.recalculatingGuideId,
          onUploadGuide: companiesWorkspace.handleCompanyGuideUpload,
          uploadingGuide: companiesWorkspace.uploadingCompanyGuide,
          onIdentifyGuide: companiesWorkspace.handleIdentifyGuide,
          onFetchGuidePdf: companiesWorkspace.handleFetchGuidePdf,
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
          onCreateFolha: accountingWorkspace.handleCreateFolha,
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
          onCreateParcelamento: accountingWorkspace.handleCreateParcelamento,
          accountingFunctions, // Q6: hook completo (functions, loading, saving, create/update/remove/apply)
          parcelamentos,       // Q9: hook de parcelamentos (parcelamentos, create, linkGuide, payParcela, rescindir)
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
        notasPanel={notasFiscais}
        certPanel={{ api, feedback }}
        feedback={{ message: feedback.message, error: feedback.error }}
        dangerActions={{
          saving: companiesWorkspace.companyDangerSaving,
          onSuspend: (reason) => companiesWorkspace.handleSuspendCompany(
            companiesWorkspace.companiesState.selectedCompanyId, reason),
          onResume: () => companiesWorkspace.handleResumeCompany(
            companiesWorkspace.companiesState.selectedCompanyId),
          onDelete: ({ confirmCnpj }) => companiesWorkspace.handleDeleteCompany(
            companiesWorkspace.companiesState.selectedCompanyId, { confirmCnpj }),
        }}
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

  if (session.page === "batchEmail") {
    return (
      <BatchEmailPage
        report={companiesWorkspace.batchEmailReport}
        loading={companiesWorkspace.loadingBatchEmailReport}
        sending={companiesWorkspace.sendingBatchEmails}
        onBack={() => session.setPage("companies")}
        onLoad={companiesWorkspace.handleLoadBatchEmailReport}
        onSend={companiesWorkspace.handleSendBatchEmails}
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
      onOpenChartGlobal={() => session.setPage("chartOfAccountsGlobal")}
      onRefreshCompanies={companiesWorkspace.loadCompanies}
      dashboardCompetencia={companiesWorkspace.dashboardCompetencia}
      onChangeCompetencia={companiesWorkspace.changeDashboardCompetencia}
      onOpenPendingReport={() => session.setPage("pendingReport")}
      onOpenBatchEmail={() => session.setPage("batchEmail")}
      onOpenApuracao={() => session.setPage("apuracao")}
      onOpenRotinas={() => session.setPage("rotinas")}
      onOpenSerproFuncoes={() => session.setPage("serproFuncoes")}
      onOpenPendencias={() => session.setPage("pendencias")}
      onLogout={handleLogout}
      onOpenCompany={(companyId) => {
        // Q8.C.3: setSelectedCompanyId pode rodar 1 tick depois (React batching).
        // Por isso passamos companyId explicitamente pro setPage adapter, que monta a URL imediato.
        companiesWorkspace.companiesState.setSelectedCompanyId(companyId);
        session.setPage("companyDetail", { companyId });
      }}
      jobEnabled={companiesWorkspace.jobEnabled}
      onToggleJob={companiesWorkspace.handleToggleJob}
      globalChartStatus={companiesWorkspace.globalChartStatus}
      message={feedback.message}
      error={feedback.error}
    />
  );
}

export default App;
