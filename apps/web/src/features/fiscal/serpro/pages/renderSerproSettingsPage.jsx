import { useEffect, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

// Q47: as "Buscas SERPRO" saíram desta página para a página top-level "Funções em lote"
// (renderSerproFuncoesPage.jsx), e as agendas de cron para "Rotinas" (renderRotinasPage.jsx).
// Aqui ficam só as credenciais (Integra Contador) + certificado.
//
// Os campos de cron NÃO ficam neste form de propósito: onSave(form) manda só o que está aqui,
// e o backend faz merge — assim salvar credencial não sobrescreve a agenda definida em Rotinas.

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
  });
  const [certificateFile, setCertificateFile] = useState(null);
  const [certificatePassword, setCertificatePassword] = useState("");

  useEffect(() => {
    setForm({
      enabled: Boolean(settings?.enabled),
      environment: settings?.environment || "homolog",
      authUrl: settings?.authUrl || "https://autenticacao.sapi.serpro.gov.br/authenticate",
      baseUrl: settings?.baseUrl || "",
      consumerKey: settings?.consumerKey || "",
      consumerSecret: "",
      scope: settings?.scope || "",
      timeoutMs: Number(settings?.timeoutMs || 30000),
    });
  }, [settings]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
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
      subtitle="Certificado do procurador e credenciais da API. As agendas automáticas ficam em Rotinas e as buscas por empresa em Funções em lote."
      onBack={onBack}
    >
      <AppShell className="serpro-settings-shell">
        <div className="serpro-settings-page">
          {/* ── Config SERPRO (Integra Contador) — só conexão/credenciais (agenda → Rotinas) ── */}
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
