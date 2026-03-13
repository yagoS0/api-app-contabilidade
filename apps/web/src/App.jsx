import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "./api/client";
import "./App.css";
import { AppShell } from "./components/layout/AppShell";
import { Feedback } from "./components/ui/Feedback";
import { Button } from "./components/ui/Button";
import { CompaniesHomePage } from "./features/companies/pages/CompaniesHomePage";
import { CompanyFormPage } from "./features/companies/pages/CompanyFormPage";
import { CompanyDetailPage } from "./features/companies/pages/CompanyDetailPage";
import { GuideSettingsPage } from "./features/guides/pages/GuideSettingsPage";
import { useCompanies } from "./features/companies/hooks/useCompanies";
import { useCompanyGuides } from "./features/companies/hooks/useCompanyGuides";
import {
  getInitialCompanyFormState,
  mapCompanyToEditForm,
  useCompanyForm,
} from "./features/companies/hooks/useCompanyForm";

const api = createApiClient();
const TOKEN_STORAGE_KEY = "portal_firm_access_token";
const LAST_PARSER_URL_KEY = "portal_firm_last_parser_url";

function fmtMoney(value) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function fmtDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("pt-BR");
}

function cronToTimeValue(cronExpression) {
  const value = String(cronExpression || "").trim();
  const parts = value.split(/\s+/);
  if (parts.length !== 5) return "";
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (Number.isNaN(minute) || Number.isNaN(hour)) return "";
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return "";
  if (parts[2] !== "*" || parts[3] !== "*" || parts[4] !== "*") return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeValueToDailyCron(timeValue) {
  const raw = String(timeValue || "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return "";
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${minute} ${hour} * * *`;
}

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
  const [sending, setSending] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [jobEnabled, setJobEnabled] = useState(false);
  const [guideSettings, setGuideSettings] = useState(null);
  const [guideSettingsForm, setGuideSettingsForm] = useState({
    guideDriveInboxId: "",
    guideDriveOutputRootId: "",
  });
  const [cronTimeValue, setCronTimeValue] = useState("");
  const [savingCron, setSavingCron] = useState(false);
  const [savingGuideSettings, setSavingGuideSettings] = useState(false);
  const [pendingGuides, setPendingGuides] = useState([]);
  const [selectedPendingGuideIds, setSelectedPendingGuideIds] = useState([]);
  const [loadingPendingGuides, setLoadingPendingGuides] = useState(false);
  const [sendingSelectedPending, setSendingSelectedPending] = useState(false);
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
    setSettingsLoading(true);
    clearFeedback();
    try {
      const settings = await api.getGuideSettings();
      setGuideSettings(settings);
      setGuideSettingsForm({
        guideDriveInboxId: String(settings?.guideDriveInboxId || ""),
        guideDriveOutputRootId: String(settings?.guideDriveOutputRootId || ""),
      });
      setCronTimeValue(cronToTimeValue(settings?.guideScheduleCron));
      const enabled = Boolean(
        settings?.guideDriveInboxId &&
          settings?.guideDriveOutputRootId &&
          settings?.guideParserUrl
      );
      setJobEnabled(enabled);
      if (settings?.guideParserUrl) {
        localStorage.setItem(LAST_PARSER_URL_KEY, settings.guideParserUrl);
      }
    } catch (err) {
      setError(err?.message || "Falha ao carregar configuracao do job");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function handleSaveGuideSettings(event) {
    event.preventDefault();
    setSavingGuideSettings(true);
    clearFeedback();
    try {
      const saved = await api.updateGuideSettings({
        guideDriveInboxId: guideSettingsForm.guideDriveInboxId,
        guideDriveOutputRootId: guideSettingsForm.guideDriveOutputRootId,
      });
      const settings = saved?.settings || saved;
      setGuideSettings(settings);
      setGuideSettingsForm({
        guideDriveInboxId: String(settings?.guideDriveInboxId || ""),
        guideDriveOutputRootId: String(settings?.guideDriveOutputRootId || ""),
      });
      setJobEnabled(
        Boolean(
          settings?.guideDriveInboxId &&
            settings?.guideDriveOutputRootId &&
            settings?.guideParserUrl
        )
      );
      setMessage("Configuração das pastas salva com sucesso.");
    } catch (err) {
      setError(err?.message || "Falha ao salvar configuração das pastas.");
    } finally {
      setSavingGuideSettings(false);
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

  async function handleToggleJob() {
    if (!guideSettings) return;
    setSettingsLoading(true);
    clearFeedback();
    try {
      if (jobEnabled) {
        const saved = await api.updateGuideSettings({
          guideParserUrl: "",
        });
        setGuideSettings(saved?.settings || saved);
        setJobEnabled(false);
        setMessage("Job desligado com sucesso.");
      } else {
        const parserUrl =
          localStorage.getItem(LAST_PARSER_URL_KEY) ||
          guideSettings?.guideParserUrl ||
          "http://localhost:8787";
        const saved = await api.updateGuideSettings({
          guideParserUrl: parserUrl,
        });
        setGuideSettings(saved?.settings || saved);
        setJobEnabled(true);
        setMessage("Job ligado com sucesso.");
      }
    } catch (err) {
      setError(err?.message || "Falha ao atualizar estado do job");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function handleSaveCronSchedule() {
    setSavingCron(true);
    clearFeedback();
    try {
      const cronExpression = timeValueToDailyCron(cronTimeValue);
      if (cronTimeValue && !cronExpression) {
        throw new Error("Hora inválida para cron.");
      }
      const saved = await api.updateGuideSettings({
        guideScheduleCron: cronExpression,
      });
      const settings = saved?.settings || saved;
      setGuideSettings(settings);
      setCronTimeValue(cronToTimeValue(settings?.guideScheduleCron));
      setMessage(
        settings?.guideScheduleCron
          ? `Cron diário configurado para ${cronToTimeValue(settings.guideScheduleCron)}.`
          : "Cron desativado."
      );
    } catch (err) {
      setError(err?.message || "Falha ao salvar agendamento do cron.");
    } finally {
      setSavingCron(false);
    }
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

  async function handleRunIngestionAndSendPending() {
    setSending(true);
    clearFeedback();
    try {
      const ingestionPayload = await api.runGuideIngestion({
        batchSize: 25,
        maxDurationMs: 25000,
      });
      const ingestion = ingestionPayload?.result || {};
      const emailsPayload = await api.sendPendingGuideEmails({
        batchSize: 50,
        maxBatches: 50,
      });
      const emailResult = emailsPayload?.result || {};
      const processed = Number(ingestion?.processed || 0);
      const ingestionErrors = Number(ingestion?.errors || 0);
      const skipped = Number(ingestion?.skippedItems || 0);
      const sent = Number(emailResult?.sent || 0);
      const failed = Number(emailResult?.failed || 0);
      const totalProcessed = Number(emailResult?.totalProcessed || 0);
      setMessage(
        `Inbox processada: ${processed} processadas, ${ingestionErrors} com erro, ${skipped} ignoradas. ` +
          `E-mails: ${sent} enviados, ${failed} falhas (total ${totalProcessed}).`
      );
      await loadCompanies();
    } catch (err) {
      setError(err?.message || "Falha ao processar inbox e enviar e-mails.");
    } finally {
      setSending(false);
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  if (page === "login") {
    return (
      <AppShell>
        <header className="header">
          <h1>Portal Firm</h1>
          <p>
            Modo da API: <b>{api.mode}</b>
          </p>
        </header>
        <section className="panel">
          <h2>Entrar</h2>
          <form className="form-grid" onSubmit={handleLogin}>
            <label>
              E-mail ou usuario
              <input
                value={loginIdentifier}
                onChange={(event) => setLoginIdentifier(event.target.value)}
                placeholder="admin@empresa.com"
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                required
              />
            </label>
            <div className="form-actions">
              <Button type="submit" disabled={authLoading}>
                {authLoading ? "Entrando..." : "Entrar"}
              </Button>
            </div>
          </form>
          <Feedback error={error} />
        </section>
      </AppShell>
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
        form={guideSettingsForm}
        onChange={(field, value) => setGuideSettingsForm((old) => ({ ...old, [field]: value }))}
        onSubmit={handleSaveGuideSettings}
        onBack={() => setPage("companies")}
        submitting={savingGuideSettings}
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
      <AppShell>
        <header className="header inline-header">
          <div>
            <h1>Pendências de e-mail</h1>
            <p>Relatório global de guias pendentes por empresa.</p>
          </div>
          <div className="row-actions">
            <Button variant="secondary" onClick={loadPendingGuidesReport} disabled={loadingPendingGuides}>
              Atualizar
            </Button>
            <Button variant="secondary" onClick={() => setPage("companies")}>
              Voltar
            </Button>
          </div>
        </header>
        <section className="panel">
          <div className="inline-header">
            <h2>Guias pendentes</h2>
            <div className="row-actions">
              <Button variant="secondary" onClick={toggleAllPendingGuides} disabled={!pendingGuides.length}>
                {selectedPendingGuideIds.length === pendingGuides.length && pendingGuides.length > 0
                  ? "Desmarcar todas"
                  : "Selecionar todas"}
              </Button>
              <Button onClick={handleSendSelectedPending} disabled={sendingSelectedPending}>
                {sendingSelectedPending ? "Enviando..." : "Enviar selecionadas"}
              </Button>
            </div>
          </div>
          {loadingPendingGuides ? (
            <p>Carregando pendências...</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Empresa</th>
                  <th>CNPJ</th>
                  <th>Tipo</th>
                  <th>Competência</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Status e-mail</th>
                  <th>Tentativas</th>
                  <th>Último erro</th>
                </tr>
              </thead>
              <tbody>
                {pendingGuides.map((guide) => (
                  <tr key={guide.guideId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedPendingGuideIds.includes(guide.guideId)}
                        onChange={() => togglePendingGuideSelection(guide.guideId)}
                      />
                    </td>
                    <td>{guide.companyName || "-"}</td>
                    <td>{guide.cnpj || "-"}</td>
                    <td>{guide.tipo || "-"}</td>
                    <td>{guide.competencia || "-"}</td>
                    <td>{fmtMoney(guide.valor)}</td>
                    <td>{fmtDate(guide.vencimento)}</td>
                    <td>{guide.emailStatus || "-"}</td>
                    <td>{Number(guide.emailAttempts || 0)}</td>
                    <td>{guide.emailLastError || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loadingPendingGuides && pendingGuides.length === 0 ? (
            <p>Nenhuma guia pendente encontrada.</p>
          ) : null}
        </section>
        <Feedback message={message} error={error} />
      </AppShell>
    );
  }

  return (
    <CompaniesHomePage
      user={user}
      apiMode={api.mode}
      companies={companiesState.companies}
      loadingCompanies={companiesState.loadingCompanies}
      onCreateCompany={() => setPage("createCompany")}
      onOpenGuideSettings={() => setPage("guideSettings")}
      onRefreshCompanies={loadCompanies}
      onOpenPendingReport={() => setPage("pendingReport")}
      onLogout={handleLogout}
      onOpenCompany={(companyId) => {
        companiesState.setSelectedCompanyId(companyId);
        setPage("companyDetail");
      }}
      guideSettings={guideSettings}
      settingsLoading={settingsLoading}
      jobEnabled={jobEnabled}
      onToggleJob={handleToggleJob}
      sending={sending}
      onRunIngestionAndSendPending={handleRunIngestionAndSendPending}
      cronTimeValue={cronTimeValue}
      setCronTimeValue={setCronTimeValue}
      savingCron={savingCron}
      onSaveCronSchedule={handleSaveCronSchedule}
      message={message}
      error={error}
    />
  );
}

export default App;
