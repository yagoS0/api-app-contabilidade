import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "./api/client";
import "./App.css";

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

function getInitialFormState() {
  return {
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    razaoSocial: "",
    nomeFantasia: "",
    cnpj: "",
    email: "",
    telefone: "",
    regimeTributario: "SIMPLES",
    cnaePrincipal: "",
    enderecoRua: "",
    enderecoNumero: "",
    enderecoBairro: "",
    enderecoCidade: "",
    enderecoUf: "",
    enderecoCep: "",
    enderecoComplemento: "",
  };
}

function getEditFormStateFromCompany(company) {
  const legacy = company?.legacyCompany && typeof company.legacyCompany === "object" ? company.legacyCompany : {};
  const endereco = legacy?.enderecoJson && typeof legacy.enderecoJson === "object" ? legacy.enderecoJson : {};
  return {
    ownerName: "",
    ownerEmail: String(company?.email || "").trim(),
    ownerPassword: "",
    razaoSocial: String(legacy?.razaoSocial || company?.razao || "").trim(),
    nomeFantasia: String(legacy?.nomeFantasia || "").trim(),
    cnpj: String(company?.cnpj || "").trim(),
    email: String(company?.email || "").trim(),
    telefone: String(legacy?.telefone || company?.telefone || "").trim(),
    regimeTributario: String(legacy?.regimeTributario || "SIMPLES"),
    cnaePrincipal: String(legacy?.cnaePrincipal || "").trim(),
    enderecoRua: String(endereco?.rua || "").trim(),
    enderecoNumero: String(endereco?.numero || "").trim(),
    enderecoBairro: String(endereco?.bairro || "").trim(),
    enderecoCidade: String(endereco?.cidade || company?.municipio || "").trim(),
    enderecoUf: String(endereco?.uf || company?.uf || "").trim().toUpperCase(),
    enderecoCep: String(endereco?.cep || "").trim(),
    enderecoComplemento: String(endereco?.complemento || "").trim(),
  };
}

function App() {
  const [page, setPage] = useState("login");
  const [user, setUser] = useState(null);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [guides, setGuides] = useState([]);
  const [companyForm, setCompanyForm] = useState(getInitialFormState());
  const [companyEditForm, setCompanyEditForm] = useState(getInitialFormState());
  const [companyDetailTab, setCompanyDetailTab] = useState("guides");
  const [submittingCompany, setSubmittingCompany] = useState(false);
  const [submittingCompanyEdit, setSubmittingCompanyEdit] = useState(false);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingGuides, setLoadingGuides] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendingGuideId, setResendingGuideId] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [jobEnabled, setJobEnabled] = useState(false);
  const [guideSettings, setGuideSettings] = useState(null);
  const [cronTimeValue, setCronTimeValue] = useState("");
  const [savingCron, setSavingCron] = useState(false);
  const [pendingGuides, setPendingGuides] = useState([]);
  const [selectedPendingGuideIds, setSelectedPendingGuideIds] = useState([]);
  const [loadingPendingGuides, setLoadingPendingGuides] = useState(false);
  const [sendingSelectedPending, setSendingSelectedPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedCompany = useMemo(
    () => companies.find((item) => item.companyId === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  );
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
    setCompanies([]);
    setGuides([]);
    setSelectedCompanyId("");
    setPage("login");
    clearFeedback();
  }

  async function loadCompanies() {
    if (page === "login") return;
    setLoadingCompanies(true);
    clearFeedback();
    try {
      const data = await api.listCompanies();
      setCompanies(data);
      if (!selectedCompanyId && data.length > 0) {
        setSelectedCompanyId(data[0].companyId);
      }
    } catch (err) {
      setError(err?.message || "Falha ao carregar empresas");
    } finally {
      setLoadingCompanies(false);
    }
  }

  async function loadGuides(companyId = selectedCompanyId) {
    if (!companyId) return;
    setLoadingGuides(true);
    clearFeedback();
    try {
      const items = await api.getCompanyGuides(companyId);
      setGuides(items);
    } catch (err) {
      setError(err?.message || "Falha ao carregar guias");
      setGuides([]);
    } finally {
      setLoadingGuides(false);
    }
  }

  async function loadGuideSettings() {
    if (page !== "companies") return;
    setSettingsLoading(true);
    clearFeedback();
    try {
      const settings = await api.getGuideSettings();
      setGuideSettings(settings);
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
      await api.createCompany(companyForm);
      setCompanyForm(getInitialFormState());
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
    if (!selectedCompanyId) return;
    setSubmittingCompanyEdit(true);
    clearFeedback();
    try {
      await api.updateCompany(selectedCompanyId, companyEditForm);
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
    setResendingGuideId(guideId);
    clearFeedback();
    try {
      await api.resendGuideEmail(guideId);
      setMessage("Guia colocada na fila de reenvio.");
      await loadGuides();
    } catch (err) {
      setError(err?.message || "Falha ao reenviar guia");
    } finally {
      setResendingGuideId("");
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
    if (page === "companyDetail" && selectedCompanyId) {
      loadGuides(selectedCompanyId);
      setCompanyDetailTab("guides");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, selectedCompanyId]);

  useEffect(() => {
    if (selectedCompany) {
      setCompanyEditForm(getEditFormStateFromCompany(selectedCompany));
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (page === "companies") {
      loadCompanies();
      loadGuideSettings();
    } else if (page === "pendingReport") {
      loadPendingGuidesReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  if (page === "login") {
    return (
      <main className="layout">
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
            <button type="submit" disabled={authLoading}>
              {authLoading ? "Entrando..." : "Entrar"}
            </button>
          </form>
          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (page === "createCompany") {
    return (
      <main className="layout">
        <header className="header inline-header">
          <div>
            <h1>Nova empresa</h1>
            <p>Preencha os dados minimos para cadastro.</p>
          </div>
          <button className="secondary" onClick={() => setPage("companies")}>
            Voltar
          </button>
        </header>
        <section className="panel">
          <form className="form-grid two-col" onSubmit={handleCreateCompany}>
            <label>
              Nome do responsavel
              <input
                value={companyForm.ownerName}
                onChange={(event) => setCompanyForm((old) => ({ ...old, ownerName: event.target.value }))}
              />
            </label>
            <label>
              E-mail do responsavel
              <input
                type="email"
                value={companyForm.ownerEmail}
                onChange={(event) => setCompanyForm((old) => ({ ...old, ownerEmail: event.target.value }))}
                required
              />
            </label>
            <label>
              Senha do responsavel
              <input
                type="password"
                value={companyForm.ownerPassword}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, ownerPassword: event.target.value }))
                }
                required
              />
            </label>
            <label>
              CNPJ
              <input
                value={companyForm.cnpj}
                onChange={(event) => setCompanyForm((old) => ({ ...old, cnpj: event.target.value }))}
                required
              />
            </label>
            <label>
              Razao social
              <input
                value={companyForm.razaoSocial}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, razaoSocial: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Nome fantasia
              <input
                value={companyForm.nomeFantasia}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, nomeFantasia: event.target.value }))
                }
              />
            </label>
            <label>
              E-mail da empresa
              <input
                type="email"
                value={companyForm.email}
                onChange={(event) => setCompanyForm((old) => ({ ...old, email: event.target.value }))}
              />
            </label>
            <label>
              Telefone
              <input
                value={companyForm.telefone}
                onChange={(event) => setCompanyForm((old) => ({ ...old, telefone: event.target.value }))}
              />
            </label>
            <label>
              Regime tributario
              <select
                value={companyForm.regimeTributario}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, regimeTributario: event.target.value }))
                }
              >
                <option value="SIMPLES">SIMPLES</option>
                <option value="LUCRO_PRESUMIDO">LUCRO_PRESUMIDO</option>
                <option value="LUCRO_REAL">LUCRO_REAL</option>
              </select>
            </label>
            <label>
              CNAE principal
              <input
                value={companyForm.cnaePrincipal}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, cnaePrincipal: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Endereco - rua
              <input
                value={companyForm.enderecoRua}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, enderecoRua: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Endereco - numero
              <input
                value={companyForm.enderecoNumero}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, enderecoNumero: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Endereco - bairro
              <input
                value={companyForm.enderecoBairro}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, enderecoBairro: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Endereco - cidade
              <input
                value={companyForm.enderecoCidade}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, enderecoCidade: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Endereco - UF
              <input
                value={companyForm.enderecoUf}
                onChange={(event) => setCompanyForm((old) => ({ ...old, enderecoUf: event.target.value }))}
                required
              />
            </label>
            <label>
              Endereco - CEP
              <input
                value={companyForm.enderecoCep}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, enderecoCep: event.target.value }))
                }
                required
              />
            </label>
            <label className="full">
              Endereco - complemento
              <input
                value={companyForm.enderecoComplemento}
                onChange={(event) =>
                  setCompanyForm((old) => ({ ...old, enderecoComplemento: event.target.value }))
                }
              />
            </label>
            <button type="submit" disabled={submittingCompany}>
              {submittingCompany ? "Salvando..." : "Cadastrar empresa"}
            </button>
          </form>
          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (page === "companyDetail") {
    return (
      <main className="layout">
        <header className="header inline-header">
          <div>
            <h1>Empresa</h1>
            <p>Dados da empresa e guias processadas.</p>
          </div>
          <button className="secondary" onClick={() => setPage("companies")}>
            Voltar
          </button>
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
              <button
                className="secondary"
                onClick={() => setCompanyDetailTab("guides")}
                disabled={companyDetailTab === "guides"}
              >
                Guias
              </button>
              <button
                className="secondary"
                onClick={() => setCompanyDetailTab("edit")}
                disabled={!canEditCompany || companyDetailTab === "edit"}
                title={!canEditCompany ? "Apenas admin/contador pode editar cadastro." : ""}
              >
                Editar cadastro
              </button>
            </div>
          </section>
        ) : null}
        {companyDetailTab === "guides" ? (
          <section className="panel">
            <div className="inline-header">
              <h2>Guias</h2>
              <button className="secondary" onClick={() => loadGuides()}>
                Atualizar
              </button>
            </div>
            {loadingGuides ? (
              <p>Carregando guias...</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Competencia</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th>Email</th>
                    <th>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {guides.map((guide) => (
                    <tr key={guide.guideId || guide.id}>
                      <td>{guide.tipo || "-"}</td>
                      <td>{guide.competencia || "-"}</td>
                      <td>{fmtMoney(guide.valor)}</td>
                      <td>{guide.status || "-"}</td>
                      <td>{guide.emailStatus || "-"}</td>
                      <td>
                        <button
                          className="small"
                          disabled={resendingGuideId === (guide.guideId || guide.id)}
                          onClick={() => handleResendGuide(guide.guideId || guide.id)}
                        >
                          {resendingGuideId === (guide.guideId || guide.id) ? "Reenviando..." : "Reenviar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loadingGuides && guides.length === 0 ? <p>Nenhuma guia encontrada.</p> : null}
          </section>
        ) : (
          <section className="panel">
            <div className="inline-header">
              <h2>Editar cadastro</h2>
            </div>
            {!canEditCompany ? (
              <p className="hint">Apenas perfis admin/contador podem editar os dados da empresa.</p>
            ) : (
              <form className="form-grid two-col" onSubmit={handleUpdateCompany}>
                <label>
                  E-mail do responsavel
                  <input
                    type="email"
                    value={companyEditForm.ownerEmail}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, ownerEmail: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  CNPJ
                  <input
                    value={companyEditForm.cnpj}
                    onChange={(event) => setCompanyEditForm((old) => ({ ...old, cnpj: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Razao social
                  <input
                    value={companyEditForm.razaoSocial}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, razaoSocial: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Nome fantasia
                  <input
                    value={companyEditForm.nomeFantasia}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, nomeFantasia: event.target.value }))
                    }
                  />
                </label>
                <label>
                  E-mail da empresa
                  <input
                    type="email"
                    value={companyEditForm.email}
                    onChange={(event) => setCompanyEditForm((old) => ({ ...old, email: event.target.value }))}
                  />
                </label>
                <label>
                  Telefone
                  <input
                    value={companyEditForm.telefone}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, telefone: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Regime tributario
                  <select
                    value={companyEditForm.regimeTributario}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, regimeTributario: event.target.value }))
                    }
                  >
                    <option value="SIMPLES">SIMPLES</option>
                    <option value="LUCRO_PRESUMIDO">LUCRO_PRESUMIDO</option>
                    <option value="LUCRO_REAL">LUCRO_REAL</option>
                  </select>
                </label>
                <label>
                  CNAE principal
                  <input
                    value={companyEditForm.cnaePrincipal}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, cnaePrincipal: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Endereco - rua
                  <input
                    value={companyEditForm.enderecoRua}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, enderecoRua: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Endereco - numero
                  <input
                    value={companyEditForm.enderecoNumero}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, enderecoNumero: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Endereco - bairro
                  <input
                    value={companyEditForm.enderecoBairro}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, enderecoBairro: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Endereco - cidade
                  <input
                    value={companyEditForm.enderecoCidade}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, enderecoCidade: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Endereco - UF
                  <input
                    value={companyEditForm.enderecoUf}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, enderecoUf: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Endereco - CEP
                  <input
                    value={companyEditForm.enderecoCep}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, enderecoCep: event.target.value }))
                    }
                    required
                  />
                </label>
                <label className="full">
                  Endereco - complemento
                  <input
                    value={companyEditForm.enderecoComplemento}
                    onChange={(event) =>
                      setCompanyEditForm((old) => ({ ...old, enderecoComplemento: event.target.value }))
                    }
                  />
                </label>
                <button type="submit" disabled={submittingCompanyEdit}>
                  {submittingCompanyEdit ? "Salvando..." : "Salvar alterações"}
                </button>
              </form>
            )}
          </section>
        )}
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  if (page === "pendingReport") {
    return (
      <main className="layout">
        <header className="header inline-header">
          <div>
            <h1>Pendências de e-mail</h1>
            <p>Relatório global de guias pendentes por empresa.</p>
          </div>
          <div className="row-actions">
            <button className="secondary" onClick={loadPendingGuidesReport} disabled={loadingPendingGuides}>
              Atualizar
            </button>
            <button className="secondary" onClick={() => setPage("companies")}>
              Voltar
            </button>
          </div>
        </header>
        <section className="panel">
          <div className="inline-header">
            <h2>Guias pendentes</h2>
            <div className="row-actions">
              <button className="secondary" onClick={toggleAllPendingGuides} disabled={!pendingGuides.length}>
                {selectedPendingGuideIds.length === pendingGuides.length && pendingGuides.length > 0
                  ? "Desmarcar todas"
                  : "Selecionar todas"}
              </button>
              <button onClick={handleSendSelectedPending} disabled={sendingSelectedPending}>
                {sendingSelectedPending ? "Enviando..." : "Enviar selecionadas"}
              </button>
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
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="layout">
      <header className="header inline-header">
        <div>
          <h1>Empresas</h1>
          <p>
            Usuario: <b>{user?.name || "FIRM"}</b> | Modo API: <b>{api.mode}</b>
          </p>
        </div>
        <div className="row-actions">
          <button className="secondary" onClick={() => setPage("createCompany")}>
            Nova empresa
          </button>
          <button className="secondary" onClick={loadCompanies} disabled={loadingCompanies}>
            Atualizar
          </button>
          <button className="secondary" onClick={() => setPage("pendingReport")}>
            Pendências de e-mail
          </button>
          <button className="secondary danger" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>
      <section className="panel">
        <div className="inline-header">
          <h2>Job de guias</h2>
          <div className="row-actions">
            <button onClick={handleToggleJob} disabled={settingsLoading || !guideSettings}>
              {settingsLoading ? "Salvando..." : jobEnabled ? "Desligar job" : "Ligar job"}
            </button>
            <button className="secondary" onClick={handleRunIngestionAndSendPending} disabled={sending}>
              {sending ? "Processando..." : "Organizar inbox e enviar pendentes"}
            </button>
          </div>
        </div>
        <p>
          Status atual: <b>{jobEnabled ? "Ligado" : "Desligado"}</b>
        </p>
        <p className="hint">
          Controle baseado na configuracao de parser em `guides/settings`.
        </p>
      </section>
      <section className="panel">
        <div className="inline-header">
          <h2>Agendamento automático</h2>
          <button className="secondary" onClick={handleSaveCronSchedule} disabled={savingCron}>
            {savingCron ? "Salvando..." : "Salvar horário do cron"}
          </button>
        </div>
        <label>
          Hora de execução diária
          <input
            type="time"
            value={cronTimeValue}
            onChange={(event) => setCronTimeValue(event.target.value)}
          />
        </label>
        <p className="hint">
          Deixe vazio e salve para desativar. Cron atual: <b>{guideSettings?.guideScheduleCron || "desativado"}</b>
        </p>
      </section>
      <section className="cards-grid">
        {companies.map((company) => (
          <article key={company.companyId} className="company-tile">
            <h3>{company.razao}</h3>
            <p>{company.cnpj}</p>
            <button
              onClick={() => {
                setSelectedCompanyId(company.companyId);
                setPage("companyDetail");
              }}
            >
              Acessar
            </button>
          </article>
        ))}
      </section>
      {!loadingCompanies && companies.length === 0 ? (
        <section className="panel">
          <p>Nenhuma empresa encontrada.</p>
        </section>
      ) : null}
      {message ? <p className="success-text">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}

export default App;
