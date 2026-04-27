import { useEffect, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";

const SERPRO_DAY_OF_MONTH_OPTIONS = Array.from({ length: 28 }, (_, index) => {
  const day = String(index + 1);
  return { value: day, label: `Dia ${day}` };
});

function padTimePart(value) {
  return String(value).padStart(2, "0");
}

function parseSerproSchedule(cronExpression) {
  const fallback = {
    day: "5",
    time: "07:00",
    unsupported: false,
  };
  const parts = String(cronExpression || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return { ...fallback, unsupported: Boolean(cronExpression) };

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const parsedMinute = Number(minute);
  const parsedHour = Number(hour);
  const parsedDayOfMonth = Number(dayOfMonth);

  if (
    month !== "*" ||
    dayOfWeek !== "*" ||
    !Number.isInteger(parsedDayOfMonth) ||
    parsedDayOfMonth < 1 ||
    parsedDayOfMonth > 28 ||
    !Number.isInteger(parsedMinute) ||
    !Number.isInteger(parsedHour) ||
    parsedMinute < 0 ||
    parsedMinute > 59 ||
    parsedHour < 0 ||
    parsedHour > 23
  ) {
    return { ...fallback, unsupported: true };
  }

  return {
    day: String(parsedDayOfMonth),
    time: `${padTimePart(parsedHour)}:${padTimePart(parsedMinute)}`,
    unsupported: false,
  };
}

function buildSerproCron(dayOfMonth, time) {
  const numericDay = Math.max(1, Math.min(28, Number(dayOfMonth)));
  const [rawHour = "07", rawMinute = "00"] = String(time || "07:00").split(":");
  const hour = Math.max(0, Math.min(23, Number(rawHour)));
  const minute = Math.max(0, Math.min(59, Number(rawMinute)));
  return `${minute} ${hour} ${numericDay} * *`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

export function SerproSettingsPage({
  settings,
  companies,
  selectedCompanyId,
  saving,
  uploadingCertificate,
  deletingCertificate,
  checkingProcuration,
  capturingPgdasd,
  procurationStatus,
  workerStatus,
  onSave,
  onUploadCertificate,
  onDeleteCertificate,
  onLoadProcuration,
  onCheckProcuration,
  onCapturePgdasd,
  onRefreshWorkerStatus,
  onBack,
  message,
  error,
}) {
  const [form, setForm] = useState({
    enabled: false,
    environment: "homolog",
    authUrl: "https://autenticacao.sapi.serpro.gov.br/authenticate",
    baseUrl: "",
    consumerKey: "",
    consumerSecret: "",
    scope: "",
    timeoutMs: 30000,
    fetchCron: "0 7 5 * *",
  });
  const [certificateFile, setCertificateFile] = useState(null);
  const [certificatePassword, setCertificatePassword] = useState("");
  const [scheduleDay, setScheduleDay] = useState("5");
  const [scheduleTime, setScheduleTime] = useState("07:00");
  const [scheduleUnsupported, setScheduleUnsupported] = useState(false);
  const [testCompanyId, setTestCompanyId] = useState("");
  const [testCompetencia, setTestCompetencia] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [testContratanteCnpj, setTestContratanteCnpj] = useState("");

  useEffect(() => {
    const parsedSchedule = parseSerproSchedule(settings?.fetchCron || "0 7 5 * *");
    setForm({
      enabled: Boolean(settings?.enabled),
      environment: settings?.environment || "homolog",
      authUrl: settings?.authUrl || "https://autenticacao.sapi.serpro.gov.br/authenticate",
      baseUrl: settings?.baseUrl || "",
      consumerKey: settings?.consumerKey || "",
      consumerSecret: "",
      scope: settings?.scope || "",
      timeoutMs: Number(settings?.timeoutMs || 30000),
      fetchCron: settings?.fetchCron || "0 7 5 * *",
    });
    setScheduleDay(parsedSchedule.day);
    setScheduleTime(parsedSchedule.time);
    setScheduleUnsupported(parsedSchedule.unsupported);
  }, [settings]);

  useEffect(() => {
    if (selectedCompanyId) {
      setTestCompanyId(selectedCompanyId);
      onLoadProcuration?.(selectedCompanyId);
      return;
    }
    const firstCompanyId = companies?.[0]?.companyId || "";
    setTestCompanyId(firstCompanyId);
    if (firstCompanyId) onLoadProcuration?.(firstCompanyId);
  }, [companies, onLoadProcuration, selectedCompanyId]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleScheduleDayChange(value) {
    setScheduleDay(value);
    setScheduleUnsupported(false);
    setField("fetchCron", buildSerproCron(value, scheduleTime));
  }

  function handleScheduleTimeChange(value) {
    setScheduleTime(value);
    setScheduleUnsupported(false);
    setField("fetchCron", buildSerproCron(scheduleDay, value));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await onSave(form);
  }

  async function handleCertificateUpload(event) {
    event.preventDefault();
    const ok = await onUploadCertificate({ file: certificateFile, password: certificatePassword });
    if (ok) {
      setCertificatePassword("");
      setCertificateFile(null);
    }
  }

  async function handleCheckProcuration(event) {
    event.preventDefault();
    await onCheckProcuration(testCompanyId, { contratanteCnpj: testContratanteCnpj || undefined });
  }

  async function handleCapturePgdasd(event) {
    event.preventDefault();
    await onCapturePgdasd(testCompanyId, {
      competencia: testCompetencia,
      contratanteCnpj: testContratanteCnpj || undefined,
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#1A1B26", display: "flex", flexDirection: "column" }}>
      <header className="company-section-header">
        <div className="company-section-header__brand">
          <button type="button" className="company-section-header__back" onClick={onBack}>
            Voltar
          </button>

          <div className="company-section-header__company">
            <strong className="company-section-header__company-name">Configuração SERPRO</strong>
            <span className="company-section-header__company-meta">
              Certificado do procurador, credenciais da API e agenda de busca automática.
            </span>
          </div>
        </div>
      </header>

      <AppShell className="serpro-settings-shell">
        <div className="serpro-settings-page">
          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h1 className="serpro-settings-card__title">Integra Contador</h1>
              <p className="serpro-settings-card__description">
                Configure a conexão principal com o SERPRO para capturar guias estruturadas direto da Receita.
              </p>
            </div>

            <form className="serpro-settings-form" onSubmit={handleSubmit}>
              <label className="serpro-settings-form__switch">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setField("enabled", event.target.checked)}
                />
                <span>Habilitar integração SERPRO</span>
              </label>

              <div className="serpro-settings-form__grid">
                <label>
                  Ambiente
                  <select value={form.environment} onChange={(event) => setField("environment", event.target.value)}>
                    <option value="homolog">Homologação</option>
                    <option value="producao">Produção</option>
                  </select>
                </label>

                <label>
                  Timeout (ms)
                  <input type="number" min="1000" value={form.timeoutMs} onChange={(event) => setField("timeoutMs", event.target.value)} />
                </label>

                <label className="full">
                  URL de autenticação
                  <input value={form.authUrl} onChange={(event) => setField("authUrl", event.target.value)} />
                </label>

                <label className="full">
                  Base URL
                  <input value={form.baseUrl} onChange={(event) => setField("baseUrl", event.target.value)} />
                </label>

                <label>
                  Consumer Key
                  <input value={form.consumerKey} onChange={(event) => setField("consumerKey", event.target.value)} />
                </label>

                <label>
                  Consumer Secret
                  <input
                    type="password"
                    value={form.consumerSecret}
                    onChange={(event) => setField("consumerSecret", event.target.value)}
                    placeholder={settings?.consumerSecretConfigured ? "Mantido se vazio" : "Informe o secret"}
                  />
                </label>

                <label className="full">
                  Scope
                  <input value={form.scope} onChange={(event) => setField("scope", event.target.value)} />
                </label>

                <div className="full">
                  <span>Agenda automática</span>
                  <div className="serpro-settings-form__grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 180px" }}>
                    <label>
                      Dia
                      <select value={scheduleDay} onChange={(event) => handleScheduleDayChange(event.target.value)}>
                        {SERPRO_DAY_OF_MONTH_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Horário
                      <input type="time" value={scheduleTime} onChange={(event) => handleScheduleTimeChange(event.target.value)} />
                    </label>
                  </div>
                  <small style={{ color: "#A7B0C0", display: "block", marginTop: 8 }}>
                    O sistema monta a expressão cron automaticamente a partir do dia do mês e horário escolhidos.
                  </small>
                  {scheduleUnsupported ? (
                    <small style={{ color: "#F4C46B", display: "block", marginTop: 8 }}>
                      A agenda salva anteriormente estava em formato avançado. Ao alterar e salvar este campo, ela será substituída pelo dia do mês e horário selecionados.
                    </small>
                  ) : null}
                </div>
              </div>

              <div className="serpro-settings-form__actions">
                <Button type="submit" variant="success" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar configuração"}
                </Button>
              </div>
            </form>
          </section>

          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head serpro-settings-card__head--row">
              <div>
                <h2 className="serpro-settings-card__title">Status do worker</h2>
                <p className="serpro-settings-card__description">
                  Acompanhe a última execução automática da captura PGDAS-D configurada pelo cron.
                </p>
              </div>
              <Button type="button" variant="secondary" onClick={onRefreshWorkerStatus}>
                Atualizar status
              </Button>
            </div>

            <div className="serpro-settings-status-grid serpro-settings-status-grid--manual">
              <div className="serpro-settings-status-item">
                <span>Worker</span>
                <strong>{workerStatus?.workerEnabled ? "Ativo" : "Desativado"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Última execução</span>
                <strong>{formatDateTime(workerStatus?.lastRun?.updatedAt)}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Competência</span>
                <strong>{workerStatus?.lastRun?.value?.competencia || "-"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Duração</span>
                <strong>
                  {workerStatus?.lastRun?.value?.summary?.durationMs
                    ? `${workerStatus.lastRun.value.summary.durationMs} ms`
                    : "-"}
                </strong>
              </div>
            </div>

            <div className="serpro-settings-status-grid serpro-settings-status-grid--manual">
              <div className="serpro-settings-status-item">
                <span>Empresas avaliadas</span>
                <strong>{workerStatus?.lastRun?.value?.summary?.totalCompanies ?? "-"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Guias capturadas</span>
                <strong>{workerStatus?.lastRun?.value?.summary?.captured ?? "-"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Falhas</span>
                <strong>{workerStatus?.lastRun?.value?.summary?.failed ?? "-"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Puladas por procuração</span>
                <strong>{workerStatus?.lastRun?.value?.summary?.skippedByProcuration ?? "-"}</strong>
              </div>
            </div>
          </section>

          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h2 className="serpro-settings-card__title">Certificado do procurador</h2>
              <p className="serpro-settings-card__description">
                Use um arquivo PFX/P12 do escritório ou procurador responsável pela autorização no Integra Contador.
              </p>
            </div>

            <div className="serpro-settings-status-grid">
              <div className="serpro-settings-status-item">
                <span>Certificado</span>
                <strong>{settings?.certificate?.hasCertificate ? "Configurado" : "Ausente"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Arquivo</span>
                <strong>{settings?.certificate?.originalName || "-"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Enviado em</span>
                <strong>{formatDateTime(settings?.certificate?.uploadedAt)}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Expira em</span>
                <strong>{formatDateTime(settings?.certificate?.expiresAt)}</strong>
              </div>
            </div>

            <form className="serpro-settings-form" onSubmit={handleCertificateUpload}>
              <div className="serpro-settings-form__grid serpro-settings-form__grid--certificate">
                <label>
                  Arquivo PFX/P12
                  <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(event) => setCertificateFile(event.target.files?.[0] || null)} />
                </label>

                <label>
                  Senha do certificado
                  <input type="password" value={certificatePassword} onChange={(event) => setCertificatePassword(event.target.value)} />
                </label>
              </div>

              <div className="serpro-settings-form__actions">
                <Button type="submit" variant="success" disabled={uploadingCertificate || !certificateFile || !certificatePassword}>
                  {uploadingCertificate ? "Enviando..." : "Enviar certificado"}
                </Button>
                <Button type="button" variant="danger" disabled={deletingCertificate || !settings?.certificate?.hasCertificate} onClick={onDeleteCertificate}>
                  {deletingCertificate ? "Removendo..." : "Remover certificado"}
                </Button>
              </div>
            </form>
          </section>

          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h2 className="serpro-settings-card__title">Teste manual</h2>
              <p className="serpro-settings-card__description">
                Consulte a procuração da empresa e capture manualmente uma guia PGDAS-D por competência.
              </p>
            </div>

            <div className="serpro-settings-status-grid serpro-settings-status-grid--manual">
              <div className="serpro-settings-status-item">
                <span>Procuração</span>
                <strong>{procurationStatus?.status || "DESCONHECIDA"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Validade</span>
                <strong>{formatDateTime(procurationStatus?.validUntil)}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Última consulta</span>
                <strong>{formatDateTime(procurationStatus?.checkedAt)}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Sistemas</span>
                <strong>{Array.isArray(procurationStatus?.systems) && procurationStatus.systems.length ? procurationStatus.systems.join(", ") : "-"}</strong>
              </div>
            </div>

            <form className="serpro-settings-form" onSubmit={handleCheckProcuration}>
              <div className="serpro-settings-form__grid">
                <label>
                  Empresa
                  <select value={testCompanyId} onChange={(event) => { setTestCompanyId(event.target.value); onLoadProcuration?.(event.target.value); }}>
                    <option value="">Selecionar empresa</option>
                    {(Array.isArray(companies) ? companies : []).map((company) => (
                      <option key={company.companyId} value={company.companyId}>
                        {company.razao}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  CNPJ do procurador (opcional)
                  <input value={testContratanteCnpj} onChange={(event) => setTestContratanteCnpj(event.target.value)} placeholder="Se vazio, usa o certificado enviado" />
                </label>
              </div>

              <div className="serpro-settings-form__actions">
                <Button type="submit" variant="secondary" disabled={checkingProcuration || !testCompanyId}>
                  {checkingProcuration ? "Consultando..." : "Consultar procuração"}
                </Button>
              </div>
            </form>

            <form className="serpro-settings-form" onSubmit={handleCapturePgdasd}>
              <div className="serpro-settings-form__grid serpro-settings-form__grid--manual-capture">
                <label>
                  Empresa
                  <select value={testCompanyId} onChange={(event) => setTestCompanyId(event.target.value)}>
                    <option value="">Selecionar empresa</option>
                    {(Array.isArray(companies) ? companies : []).map((company) => (
                      <option key={company.companyId} value={company.companyId}>
                        {company.razao}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Competência
                  <input type="month" value={testCompetencia} onChange={(event) => setTestCompetencia(event.target.value)} />
                </label>
              </div>

              <div className="serpro-settings-form__actions">
                <Button type="submit" variant="success" disabled={capturingPgdasd || !testCompanyId || !testCompetencia}>
                  {capturingPgdasd ? "Capturando..." : "Capturar PGDAS-D"}
                </Button>
              </div>
            </form>
          </section>

          <Feedback message={message} error={error} />
        </div>
      </AppShell>
    </div>
  );
}
