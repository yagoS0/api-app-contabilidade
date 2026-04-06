import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "./api/client";
import "./App.css";
import { CompaniesHomePage } from "./features/companies/pages/CompaniesHomePage";
import { CompanyFormPage } from "./features/companies/pages/CompanyFormPage";
import { CompanyDetailPage } from "./features/companies/pages/CompanyDetailPage";
import { GuideSettingsPage } from "./features/guides/pages/GuideSettingsPage";
import { GuideUploadPage } from "./features/guides/pages/GuideUploadPage";
import { LoginPage } from "./features/auth/pages/LoginPage";
import { PendingGuidesPage } from "./features/guides/pages/PendingGuidesPage";
import { useCompanies } from "./features/companies/hooks/useCompanies";
import { useCompanyGuides } from "./features/companies/hooks/useCompanyGuides";
import {
  getInitialCompanyFormState,
  mapCompanyToEditForm,
  useCompanyForm,
} from "./features/companies/hooks/useCompanyForm";

const api = createApiClient();
const TOKEN_STORAGE_KEY = "portal_firm_access_token";

function App() {
  const [page, setPage] = useState("login");
  const [user, setUser] = useState(null);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const companiesState = useCompanies();
  const guidesState = useCompanyGuides();
  const createCompanyForm = useCompanyForm(getInitialCompanyFormState());
  const editCompanyForm = useCompanyForm(getInitialCompanyFormState());
  const [companyDetailTab, setCompanyDetailTab] = useState("guides");
  const [submittingCompany, setSubmittingCompany] = useState(false);
  const [submittingCompanyEdit, setSubmittingCompanyEdit] = useState(false);
  const [jobEnabled, setJobEnabled] = useState(false);
  const [guideSettings, setGuideSettings] = useState(null);
  const [pendingGuides, setPendingGuides] = useState([]);
  const [selectedPendingGuideIds, setSelectedPendingGuideIds] = useState([]);
  const [loadingPendingGuides, setLoadingPendingGuides] = useState(false);
  const [sendingSelectedPending, setSendingSelectedPending] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);
  const [uploadingGuides, setUploadingGuides] = useState(false);
  const [unidentifiedGuides, setUnidentifiedGuides] = useState([]);
  const [loadingUnidentifiedGuides, setLoadingUnidentifiedGuides] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedCompany = companiesState.selectedCompany;
  const canEditCompany = useMemo(() => {
    const role = String(user?.role || "").toLowerCase();
    return role === "admin" || role === "contador";
  }, [user]);

  function clearFeedback() {
    setError("");
    setMessage("");
  }

  async function ensureSession() {
    const tokenFromStorage = localStorage.getItem(TOKEN_STORAGE_KEY) || "";
    if (!tokenFromStorage) return false;
    api.setAccessToken(tokenFromStorage);
    try {
      const me = await api.me();
      setUser(me);
      setPage("companies");
      return true;
    } catch {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      api.clearSession();
      setUser(null);
      setPage("login");
      return false;
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearFeedback();
    setAuthLoading(true);
    try {
      const payload = await api.login({
        identifier: loginIdentifier,
        password: loginPassword,
      });
      const token = payload?.accessToken || api.getAccessToken();
      if (token) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      }
      const me = await api.me();
      setUser(me);
      setPage("companies");
      setLoginPassword("");
    } catch (err) {
      setError(err?.message || "Falha ao autenticar");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    api.clearSession();
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setUser(null);
    companiesState.setCompanies([]);
    guidesState.setGuides([]);
    companiesState.setSelectedCompanyId("");
    setPage("login");
    clearFeedback();
  }

  async function loadCompanies() {
    if (page === "login") return;
    companiesState.setLoadingCompanies(true);
    clearFeedback();
    try {
      const data = await api.listCompanies();
      companiesState.setCompanies(data);
      if (!companiesState.selectedCompanyId && data.length > 0) {
        companiesState.setSelectedCompanyId(data[0].companyId);
      }
    } catch (err) {
      setError(err?.message || "Falha ao carregar empresas");
    } finally {
      companiesState.setLoadingCompanies(false);
    }
  }

  async function loadGuides(companyId = companiesState.selectedCompanyId) {
    if (!companyId) return;
    guidesState.setLoadingGuides(true);
    clearFeedback();
    try {
      const items = await api.getCompanyGuides(companyId);
      guidesState.setGuides(items);
    } catch (err) {
      setError(err?.message || "Falha ao carregar guias");
      guidesState.setGuides([]);
    } finally {
      guidesState.setLoadingGuides(false);
    }
  }

  async function loadGuideSettings() {
    if (page === "login") return;
    clearFeedback();
    try {
      const settings = await api.getGuideSettings();
      setGuideSettings(settings);
      setJobEnabled(Boolean(settings?.pdfReaderConfigured));
    } catch (err) {
      setError(err?.message || "Falha ao carregar configuracao do job");
    }
  }

  async function loadPendingGuidesReport() {
    setLoadingPendingGuides(true);
    clearFeedback();
    try {
      const report = await api.getPendingGuidesReport({ page: 1, limit: 200 });
      setPendingGuides(Array.isArray(report?.data) ? report.data : []);
      setSelectedPendingGuideIds([]);
    } catch (err) {
      setError(err?.message || "Falha ao carregar relatório de pendências.");
      setPendingGuides([]);
    } finally {
      setLoadingPendingGuides(false);
    }
  }

  async function loadUnidentifiedGuides() {
    setLoadingUnidentifiedGuides(true);
    try {
      const payload = await api.getUnidentifiedGuides({ page: 1, limit: 200 });
      setUnidentifiedGuides(Array.isArray(payload?.data) ? payload.data : []);
    } catch (err) {
      setError(err?.message || "Falha ao carregar pendências de identificação.");
      setUnidentifiedGuides([]);
    } finally {
      setLoadingUnidentifiedGuides(false);
    }
  }

  function handleToggleJob() {
    setMessage(
      "A leitura de PDF é feita pelo serviço pdf-reader (PDF_READER_URL na API). Os PDFs das guias ficam gravados no banco de dados. Use Upload de guias."
    );
  }

  async function handleCreateCompany(event) {
    event.preventDefault();
    setSubmittingCompany(true);
    clearFeedback();
    try {
      await api.createCompany(createCompanyForm.form);
      createCompanyForm.reset();
      setPage("companies");
      await loadCompanies();
      setMessage("Empresa cadastrada com sucesso.");
    } catch (err) {
      setError(err?.message || "Falha ao cadastrar empresa");
    } finally {
      setSubmittingCompany(false);
    }
  }

  async function handleUpdateCompany(event) {
    event.preventDefault();
    if (!companiesState.selectedCompanyId) return;
    setSubmittingCompanyEdit(true);
    clearFeedback();
    try {
      await api.updateCompany(companiesState.selectedCompanyId, editCompanyForm.form);
      setMessage("Cadastro da empresa atualizado com sucesso.");
      await loadCompanies();
      setCompanyDetailTab("guides");
    } catch (err) {
      setError(err?.message || "Falha ao atualizar cadastro da empresa.");
    } finally {
      setSubmittingCompanyEdit(false);
    }
  }

  async function handleResendGuide(guideId) {
    if (!guideId) {
      setError("guide_id_not_found");
      return;
    }
    guidesState.setResendingGuideId(guideId);
    clearFeedback();
    try {
      await api.resendGuideEmail(guideId);
      setMessage("Guia colocada na fila de reenvio.");
      await loadGuides();
    } catch (err) {
      setError(err?.message || "Falha ao reenviar guia");
    } finally {
      guidesState.setResendingGuideId("");
    }
  }

  async function handleGuideUpload(files) {
    if (!Array.isArray(files) || !files.length) {
      setError("Selecione pelo menos um PDF para enviar.");
      return false;
    }
    setUploadingGuides(true);
    clearFeedback();
    try {
      const payload = await api.uploadGuides(files);
      const result = payload?.result || {};
      setUploadResults(Array.isArray(result?.items) ? result.items : []);
      const processed = Number(result?.processed || 0);
      const errors = Number(result?.errors || 0);
      const skipped = Number(result?.skipped || 0);
      const sent = Number(result?.sent || 0);
      const failed = Number(result?.failedToSend || 0);
      const emailSuffix = result?.emailDispatch?.skipped
        ? " O envio automático não pôde iniciar porque outro envio já está em andamento."
        : "";
      setMessage(
        `Upload concluído: ${processed} processadas, ${errors} com erro, ${skipped} ignoradas. ` +
          `E-mails: ${sent} enviados, ${failed} falhas.${emailSuffix}`
      );
      await loadUnidentifiedGuides();
      return true;
    } catch (err) {
      setError(err?.message || "Falha ao enviar e processar guias.");
      return false;
    } finally {
      setUploadingGuides(false);
    }
  }

  function togglePendingGuideSelection(guideId) {
    setSelectedPendingGuideIds((old) => {
      if (old.includes(guideId)) return old.filter((id) => id !== guideId);
      return [...old, guideId];
    });
  }

  function toggleAllPendingGuides() {
    setSelectedPendingGuideIds((old) => {
      if (old.length === pendingGuides.length) return [];
      return pendingGuides.map((guide) => guide.guideId).filter(Boolean);
    });
  }

  async function handleSendSelectedPending() {
    if (!selectedPendingGuideIds.length) {
      setError("Selecione pelo menos uma guia pendente.");
      return;
    }
    setSendingSelectedPending(true);
    clearFeedback();
    try {
      const payload = await api.sendSelectedPendingEmails(selectedPendingGuideIds);
      const result = payload?.result || {};
      const sent = Number(result?.sent || 0);
      const failed = Number(result?.failed || 0);
      const totalRequested = Number(result?.totalRequested || selectedPendingGuideIds.length);
      setMessage(`Reenvio concluído: ${sent} enviadas, ${failed} falhas (total ${totalRequested}).`);
      await loadPendingGuidesReport();
    } catch (err) {
      setError(err?.message || "Falha ao reenviar guias selecionadas.");
    } finally {
      setSendingSelectedPending(false);
    }
  }

  useEffect(() => {
    ensureSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (page === "companyDetail" && companiesState.selectedCompanyId) {
      loadGuides(companiesState.selectedCompanyId);
      setCompanyDetailTab("guides");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, companiesState.selectedCompanyId]);

  useEffect(() => {
    if (selectedCompany) {
      editCompanyForm.replace(mapCompanyToEditForm(selectedCompany));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany]);

  useEffect(() => {
    if (page === "companies" || page === "guideSettings") {
      loadCompanies();
      loadGuideSettings();
    } else if (page === "pendingReport") {
      loadPendingGuidesReport();
    } else if (page === "guideUpload") {
      loadUnidentifiedGuides();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  if (page === "login") {
    return (
      <LoginPage
        apiMode={api.mode}
        identifier={loginIdentifier}
        password={loginPassword}
        onIdentifierChange={setLoginIdentifier}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLogin}
        authLoading={authLoading}
        error={error}
      />
    );
  }

  if (page === "createCompany") {
    return (
      <CompanyFormPage
        form={createCompanyForm.form}
        onChange={createCompanyForm.setField}
        onSubmit={handleCreateCompany}
        submitting={submittingCompany}
        onBack={() => setPage("companies")}
        error={error}
      />
    );
  }

  if (page === "guideSettings") {
    return (
      <GuideSettingsPage
        pdfReaderConfigured={Boolean(guideSettings?.pdfReaderConfigured)}
        onBack={() => setPage("companies")}
      />
    );
  }

  if (page === "guideUpload") {
    return (
      <GuideUploadPage
        onBack={() => setPage("companies")}
        onUpload={handleGuideUpload}
        uploading={uploadingGuides}
        uploadResults={uploadResults}
        unidentifiedGuides={unidentifiedGuides}
        loadingUnidentifiedGuides={loadingUnidentifiedGuides}
        onRefreshUnidentified={loadUnidentifiedGuides}
        message={message}
        error={error}
      />
    );
  }

  if (page === "companyDetail") {
    return (
      <CompanyDetailPage
        selectedCompany={selectedCompany}
        onBack={() => setPage("companies")}
        companyDetailTab={companyDetailTab}
        setCompanyDetailTab={setCompanyDetailTab}
        canEditCompany={canEditCompany}
        guides={guidesState.guides}
        loadingGuides={guidesState.loadingGuides}
        onRefreshGuides={() => loadGuides()}
        onResendGuide={handleResendGuide}
        resendingGuideId={guidesState.resendingGuideId}
        companyEditForm={editCompanyForm.form}
        onEditFormChange={editCompanyForm.setField}
        onUpdateCompany={handleUpdateCompany}
        submittingCompanyEdit={submittingCompanyEdit}
        message={message}
        error={error}
      />
    );
  }

  if (page === "pendingReport") {
    return (
      <PendingGuidesPage
        guides={pendingGuides}
        loading={loadingPendingGuides}
        selectedIds={selectedPendingGuideIds}
        onToggle={togglePendingGuideSelection}
        onToggleAll={toggleAllPendingGuides}
        onSendSelected={handleSendSelectedPending}
        sending={sendingSelectedPending}
        onRefresh={loadPendingGuidesReport}
        onBack={() => setPage("companies")}
        message={message}
        error={error}
      />
    );
  }

  return (
    <CompaniesHomePage
      user={user}
      apiMode={api.mode}
      companies={companiesState.companies}
      loadingCompanies={companiesState.loadingCompanies}
      onCreateCompany={() => setPage("createCompany")}
      onOpenGuideUpload={() => setPage("guideUpload")}
      onOpenGuideSettings={() => setPage("guideSettings")}
      onRefreshCompanies={loadCompanies}
      onOpenPendingReport={() => setPage("pendingReport")}
      onLogout={handleLogout}
      onOpenCompany={(companyId) => {
        companiesState.setSelectedCompanyId(companyId);
        setPage("companyDetail");
      }}
      jobEnabled={jobEnabled}
      onToggleJob={handleToggleJob}
      message={message}
      error={error}
    />
  );
}

export default App;
