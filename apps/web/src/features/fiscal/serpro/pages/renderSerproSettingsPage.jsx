import { useEffect, useMemo, useState } from "react";
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

function currentCompetencia() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Q36: expande o intervalo De..Até em uma lista de competências YYYY-MM inclusiva.
// Retorna { ok, months, error }. Cap de 12 meses para evitar disparos enormes.
function expandRange(from, to) {
  const re = /^(\d{4})-(\d{2})$/;
  const mf = String(from || "").match(re);
  const mt = String(to || "").match(re);
  if (!mf || !mt) return { ok: false, error: "Informe o intervalo De/Até." };
  const start = Number(mf[1]) * 12 + (Number(mf[2]) - 1);
  const end = Number(mt[1]) * 12 + (Number(mt[2]) - 1);
  if (end < start) return { ok: false, error: "A data inicial (De) não pode ser depois da final (Até)." };
  if (end - start > 11) return { ok: false, error: "Intervalo máximo de 12 meses por execução." };
  const months = [];
  for (let m = start; m <= end; m += 1) {
    months.push(`${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`);
  }
  return { ok: true, months };
}

const ALL_OPS = ["das", "inss", "extrato"];
const OP_LABEL = { das: "DAS", inss: "INSS", extrato: "Extrato", parcelamento: "Parcelamento", procuracao: "Procuração", pagamento: "Confirmar pagamento", sitfis: "Situação fiscal" };

export function SerproSettingsPage({
  settings,
  companies,
  saving,
  uploadingCertificate,
  deletingCertificate,
  onSave,
  onUploadCertificate,
  onDeleteCertificate,
  onRunOp,
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

  // Q36: estado das buscas (seleção de empresas, intervalo, resultado por linha).
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [dateFrom, setDateFrom] = useState(currentCompetencia);
  const [dateTo, setDateTo] = useState(currentCompetencia);
  const [results, setResults] = useState({}); // { [companyId]: { status, message } }
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, op: null });
  const [localNotice, setLocalNotice] = useState(null); // { type: "error"|"info", text }

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

  const companyList = useMemo(() => (Array.isArray(companies) ? companies : []), [companies]);

  const allSelected = companyList.length > 0 && companyList.every((c) => selectedIds.has(c.companyId));
  const someSelected = companyList.some((c) => selectedIds.has(c.companyId));

  const certReady = Boolean(settings?.certificate?.hasCertificate);
  const serproEnabled = Boolean(settings?.enabled);
  const canRun = serproEnabled && certReady && !running;

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

  function toggleOne(companyId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(() => (allSelected ? new Set() : new Set(companyList.map((c) => c.companyId))));
  }

  // Q36: orquestra o loop empresas × (meses?) × operações, sequencial, com resultado ao vivo por linha.
  async function runBatch(ops, { useRange }) {
    if (running) return;
    setLocalNotice(null);
    const ids = companyList.filter((c) => selectedIds.has(c.companyId)).map((c) => c.companyId);
    if (ids.length === 0) {
      setLocalNotice({ type: "error", text: "Selecione ao menos uma empresa na tabela." });
      return;
    }
    if (!serproEnabled) {
      setLocalNotice({ type: "error", text: "Integração SERPRO está desabilitada. Habilite e salve a configuração." });
      return;
    }
    if (!certReady) {
      setLocalNotice({ type: "error", text: "Certificado do procurador ausente. Envie o certificado antes de rodar as buscas." });
      return;
    }

    let months = [null];
    if (useRange) {
      const range = expandRange(dateFrom, dateTo);
      if (!range.ok) {
        setLocalNotice({ type: "error", text: range.error });
        return;
      }
      months = range.months;
    }

    const total = ids.length * months.length * ops.length;
    setRunning(true);
    setProgress({ done: 0, total, op: ops.map((o) => OP_LABEL[o]).join("+") });
    setResults((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { status: "running", message: null };
      return next;
    });

    let done = 0;
    let okCount = 0;
    let errCount = 0;
    for (const companyId of ids) {
      let firstError = null;
      let companyOk = 0;
      for (const month of months) {
        for (const op of ops) {
          // eslint-disable-next-line no-await-in-loop
          const res = await onRunOp(op, companyId, month);
          done += 1;
          setProgress((p) => ({ ...p, done }));
          if (res?.ok) companyOk += 1;
          else if (!firstError) firstError = `${OP_LABEL[op]}${month ? ` ${month}` : ""}: ${res?.message || "falha"}`;
        }
      }
      if (firstError) {
        errCount += 1;
        setResults((prev) => ({ ...prev, [companyId]: { status: "erro", message: firstError } }));
      } else {
        okCount += 1;
        setResults((prev) => ({ ...prev, [companyId]: { status: "ok", message: `${companyOk} operação(ões) ok` } }));
      }
    }

    setRunning(false);
    setProgress({ done: 0, total: 0, op: null });
    setLocalNotice({
      type: errCount ? "error" : "info",
      text: `Concluído: ${okCount} empresa(s) ok${errCount ? `, ${errCount} com erro (ver coluna Resultado)` : ""}.`,
    });
  }

  function renderResultCell(companyId) {
    const r = results[companyId];
    if (!r || r.status === "idle") return <span style={{ color: "#6b7280" }}>—</span>;
    if (r.status === "running") return <span style={{ color: "#8BE9FD" }}>⏳ rodando…</span>;
    if (r.status === "ok") return <span style={{ color: "#69FF47" }} title={r.message || ""}>✓ ok</span>;
    return <span style={{ color: "#FF4757" }} title={r.message || ""}>⚠ erro</span>;
  }

  return (
    <PageShell
      title="Configuração SERPRO"
      subtitle="Certificado do procurador, credenciais da API, agenda automática e buscas por empresa."
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

          {/* ── Buscas SERPRO (tabela de empresas + ações por intervalo) ── */}
          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h2 className="serpro-settings-card__title">Buscas SERPRO</h2>
              <p className="serpro-settings-card__description">
                Selecione as empresas, escolha o intervalo (De/Até) e rode as buscas. Os resultados aparecem por linha.
              </p>
            </div>

            {(!serproEnabled || !certReady) && (
              <div style={{ margin: "0 0 12px", padding: "10px 12px", borderRadius: 6, background: "rgba(255,179,71,0.15)", border: "1px solid #FFB347", color: "#FFB347", fontSize: "0.85rem" }}>
                {!serproEnabled && <div>⚠ Integração SERPRO desabilitada — habilite e salve em "Integra Contador".</div>}
                {!certReady && <div>⚠ Certificado do procurador ausente — envie o PFX/P12 acima.</div>}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", color: "#A7B0C0" }}>
                De
                <input type="month" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} disabled={running} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", color: "#A7B0C0" }}>
                Até
                <input type="month" value={dateTo} onChange={(event) => setDateTo(event.target.value)} disabled={running} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <Button type="button" variant="success" disabled={!canRun || !someSelected} onClick={() => runBatch(ALL_OPS, { useRange: true })}>
                {running ? `Rodando… (${progress.done}/${progress.total})` : "Rodar todas as buscas"}
              </Button>
              <Button type="button" variant="secondary" disabled={!canRun || !someSelected} onClick={() => runBatch(["das"], { useRange: true })}>DAS</Button>
              <Button type="button" variant="secondary" disabled={!canRun || !someSelected} onClick={() => runBatch(["inss"], { useRange: true })}>INSS</Button>
              <Button type="button" variant="secondary" disabled={!canRun || !someSelected} onClick={() => runBatch(["extrato"], { useRange: true })}>Extrato</Button>
              <Button type="button" variant="secondary" disabled={!canRun || !someSelected} onClick={() => runBatch(["parcelamento"], { useRange: false })} title="Captura as parcelas geráveis (ignora o intervalo)">Parcelamento</Button>
              <Button type="button" variant="secondary" disabled={!canRun || !someSelected} onClick={() => runBatch(["pagamento"], { useRange: true })} title="Confirma o pagamento das guias em aberto (PAGTOWEB) no intervalo">Confirmar pagamento</Button>
              <Button type="button" variant="secondary" disabled={!canRun || !someSelected} onClick={() => runBatch(["sitfis"], { useRange: false })} title="Consulta a situação fiscal (SITFIS) — ignora o intervalo">Situação fiscal (SITFIS)</Button>
              <Button type="button" variant="secondary" disabled={!canRun || !someSelected} onClick={() => runBatch(["procuracao"], { useRange: false })}>Testar procuração</Button>
            </div>

            {localNotice && (
              <div style={{
                margin: "0 0 12px", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem",
                background: localNotice.type === "error" ? "rgba(255,71,87,0.12)" : "rgba(105,255,71,0.10)",
                border: `1px solid ${localNotice.type === "error" ? "#FF4757" : "#69FF47"}`,
                color: localNotice.type === "error" ? "#FF4757" : "#69FF47",
              }}>
                {localNotice.text}
              </div>
            )}

            <div style={{ overflowX: "auto", border: "1px solid #2b2d45", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#21222C", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px", width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={toggleAll}
                        aria-label="Selecionar todas"
                        disabled={running}
                      />
                    </th>
                    <th style={{ padding: "8px 10px" }}>Empresa</th>
                    <th style={{ padding: "8px 10px" }}>CNPJ</th>
                    <th style={{ padding: "8px 10px" }}>Regime</th>
                    <th style={{ padding: "8px 10px" }}>Procuração</th>
                    <th style={{ padding: "8px 10px" }}>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {companyList.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>Nenhuma empresa.</td></tr>
                  )}
                  {companyList.map((company) => {
                    const checked = selectedIds.has(company.companyId);
                    const regime = company.legacyCompany?.regimeTributario || company.legacyCompany?.tipoTributario || "—";
                    const proc = company.serproStatus?.procurationStatus || company.serproStatus?.status || "—";
                    return (
                      <tr key={company.companyId} style={{ borderTop: "1px solid #2b2d45", background: checked ? "rgba(189,147,249,0.06)" : "transparent" }}>
                        <td style={{ padding: "8px 10px" }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleOne(company.companyId)} disabled={running} aria-label={`Selecionar ${company.razao}`} />
                        </td>
                        <td style={{ padding: "8px 10px", color: "#F8F8F2" }}>{company.razao}</td>
                        <td style={{ padding: "8px 10px", color: "#A7B0C0" }}>{company.cnpj}</td>
                        <td style={{ padding: "8px 10px", color: "#A7B0C0" }}>{regime}</td>
                        <td style={{ padding: "8px 10px", color: "#A7B0C0" }}>{proc}</td>
                        <td style={{ padding: "8px 10px" }}>{renderResultCell(company.companyId)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <Feedback message={message} error={error} />
        </div>
      </AppShell>
    </PageShell>
  );
}
