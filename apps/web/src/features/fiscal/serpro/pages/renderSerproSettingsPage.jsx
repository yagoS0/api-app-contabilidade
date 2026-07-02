import { useEffect, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";

const SERPRO_DAY_OF_MONTH_OPTIONS = Array.from({ length: 31 }, (_, index) => {
  const day = String(index + 1);
  // Marca dias 29-31 como "fim de mês" para deixar claro que pode não existir em fevereiro
  const label = index >= 28 ? `Dia ${day} (fim de mês)` : `Dia ${day}`;
  return { value: day, label };
});

function padTimePart(value) {
  return String(value).padStart(2, "0");
}

function parseSerproSchedule(cronExpression) {
  const fallback = { day: "5", time: "07:00", unsupported: false };
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
    parsedDayOfMonth > 31 ||
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

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

// Q47: as "Buscas SERPRO" saíram desta página para a página top-level "Funções SERPRO"
// (renderSerproFuncoesPage.jsx). Aqui ficam só as credenciais (Integra Contador) + certificado.

export function SerproSettingsPage({
  settings,
  saving,
  uploadingCertificate,
  deletingCertificate,
  onSave,
  onUploadCertificate,
  onDeleteCertificate,
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
    fetchDay: 5,
    fetchHour: 7,
    // Q40: cron próprio de confirmação de pagamento (PAGTOWEB).
    paymentConfirmationEnabled: false,
    paymentConfirmationDay: 10,
    paymentConfirmationHour: 8,
  });
  const [certificateFile, setCertificateFile] = useState(null);
  const [certificatePassword, setCertificatePassword] = useState("");
  const [scheduleDay, setScheduleDay] = useState("5");
  const [scheduleTime, setScheduleTime] = useState("07:00");
  const [scheduleUnsupported, setScheduleUnsupported] = useState(false);

  useEffect(() => {
    const fetchDay = Number.isFinite(Number(settings?.fetchDay))
      ? Number(settings.fetchDay)
      : parseSerproSchedule(settings?.fetchCron || "0 7 5 * *").day;
    const fetchHour = Number.isFinite(Number(settings?.fetchHour))
      ? Number(settings.fetchHour)
      : Number(parseSerproSchedule(settings?.fetchCron || "0 7 5 * *").time.split(":")[0]);
    setForm({
      enabled: Boolean(settings?.enabled),
      environment: settings?.environment || "homolog",
      authUrl: settings?.authUrl || "https://autenticacao.sapi.serpro.gov.br/authenticate",
      baseUrl: settings?.baseUrl || "",
      consumerKey: settings?.consumerKey || "",
      consumerSecret: "",
      scope: settings?.scope || "",
      timeoutMs: Number(settings?.timeoutMs || 30000),
      fetchDay,
      fetchHour,
      paymentConfirmationEnabled: Boolean(settings?.paymentConfirmationEnabled),
      paymentConfirmationDay: Number.isFinite(Number(settings?.paymentConfirmationDay)) ? Number(settings.paymentConfirmationDay) : 10,
      paymentConfirmationHour: Number.isFinite(Number(settings?.paymentConfirmationHour)) ? Number(settings.paymentConfirmationHour) : 8,
    });
    setScheduleDay(String(fetchDay));
    setScheduleTime(`${padTimePart(fetchHour)}:00`);
    setScheduleUnsupported(false);
  }, [settings]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleScheduleDayChange(value) {
    setScheduleDay(value);
    setScheduleUnsupported(false);
    setField("fetchDay", Math.max(1, Math.min(31, Number(value) || 5)));
  }

  function handleScheduleTimeChange(value) {
    setScheduleTime(value);
    setScheduleUnsupported(false);
    setField("fetchHour", Math.max(0, Math.min(23, Number(String(value || "07:00").split(":")[0]) || 7)));
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

  return (
    <PageShell
      title="Configuração SERPRO"
      subtitle="Certificado do procurador, credenciais da API e agenda automática. As buscas por empresa ficam em Funções SERPRO."
      onBack={onBack}
    >
      <AppShell className="serpro-settings-shell">
        <div className="serpro-settings-page">
          {/* ── Config SERPRO (Integra Contador) — inclui a agenda do CRON ── */}
          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h1 className="serpro-settings-card__title">Integra Contador</h1>
              <p className="serpro-settings-card__description">
                Configure a conexão principal com o SERPRO para capturar guias estruturadas direto da Receita.
              </p>
            </div>

            <form className="serpro-settings-form" onSubmit={handleSubmit}>
              <label className="serpro-settings-form__switch">
                <input type="checkbox" checked={form.enabled} onChange={(event) => setField("enabled", event.target.checked)} />
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
                  <span>Agenda automática (CRON)</span>
                  <div className="serpro-settings-form__grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 180px" }}>
                    <label>
                      Dia
                      <select value={scheduleDay} onChange={(event) => handleScheduleDayChange(event.target.value)}>
                        {SERPRO_DAY_OF_MONTH_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Horário
                      <input type="time" value={scheduleTime} onChange={(event) => handleScheduleTimeChange(event.target.value)} />
                    </label>
                  </div>
                  <small style={{ color: "#A7B0C0", display: "block", marginTop: 8 }}>
                    O worker faz a captura inicial (extrato + DAS + INSS) no dia/horário escolhidos e depois executa
                    diariamente até o vencimento de cada guia. E-mail só na captura inicial e no dia do vencimento.
                  </small>
                  {scheduleUnsupported ? (
                    <small style={{ color: "#F4C46B", display: "block", marginTop: 8 }}>
                      A agenda salva anteriormente estava em formato avançado. Ao salvar, será substituída pelo dia/horário escolhidos.
                    </small>
                  ) : null}
                </div>

              </div>

              {/* Q40: cron próprio de confirmação de pagamento (PAGTOWEB).
                  Fora do .serpro-settings-form__grid de propósito — dentro da grid o checkbox
                  herdava min-height:44px + width total (ficava gigante/centralizado). */}
              <div style={{ borderTop: "1px solid #2b2d45", paddingTop: 16, marginTop: 4 }}>
                <label className="serpro-settings-form__switch">
                  <input
                    type="checkbox"
                    style={{ width: 16, height: 16, flex: "none" }}
                    checked={form.paymentConfirmationEnabled}
                    onChange={(event) => setField("paymentConfirmationEnabled", event.target.checked)}
                  />
                  <span>Confirmação de pagamento automática (cron)</span>
                </label>
                <div className="serpro-settings-form__grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 180px", marginTop: 12 }}>
                  <label>
                    Dia
                    <select
                      value={String(form.paymentConfirmationDay)}
                      onChange={(event) => setField("paymentConfirmationDay", Math.max(1, Math.min(31, Number(event.target.value) || 10)))}
                      disabled={!form.paymentConfirmationEnabled}
                    >
                      {SERPRO_DAY_OF_MONTH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Horário
                    <input
                      type="time"
                      value={`${padTimePart(form.paymentConfirmationHour)}:00`}
                      onChange={(event) => setField("paymentConfirmationHour", Math.max(0, Math.min(23, Number(String(event.target.value || "08:00").split(":")[0]) || 8)))}
                      disabled={!form.paymentConfirmationEnabled}
                    />
                  </label>
                </div>
                <small style={{ color: "#A7B0C0", display: "block", marginTop: 8 }}>
                  Consulta o comprovante oficial (PAGTOWEB) das guias em aberto e marca as pagas, gerando a baixa
                  contábil. Requer o serviço PAGTOWEB validado no SERPRO.
                </small>
              </div>

              <div className="serpro-settings-form__actions">
                <Button type="submit" variant="success" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar configuração"}
                </Button>
              </div>
            </form>
          </section>

          {/* ── Certificado do procurador ── */}
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

          <Feedback message={message} error={error} />
        </div>
      </AppShell>
    </PageShell>
  );
}
