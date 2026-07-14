import { useEffect, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => {
  const day = String(index + 1);
  // Marca dias 29-31 como "fim de mês" — pode não existir em fevereiro.
  const label = index >= 28 ? `Dia ${day} (fim de mês)` : `Dia ${day}`;
  return { value: day, label };
});

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

// Página "Rotinas" — centraliza os cron jobs do escritório. Hoje: os 2 crons SERPRO
// (captura de guias + confirmação de pagamento/PAGTOWEB), que saíram de Configuração SERPRO.
// Salva via PATCH /firm/serpro/settings mandando SÓ os campos de cron — o backend
// (updateSerproRuntimeSettings) faz merge, então credenciais/certificado ficam intactos.
export function RotinasPage({
  settings,
  saving,
  workerStatus,
  onSave,
  onRunCron,
  runningCron,
  cronRunResult,
  onRefreshWorkerStatus,
  onRunPaymentConfirmation,
  onBack,
  message,
  error,
}) {
  const [form, setForm] = useState({
    fetchDay: 5,
    fetchHour: 7,
    paymentConfirmationEnabled: false,
    paymentConfirmationDay: 10,
    paymentConfirmationHour: 8,
  });
  const [runningPayment, setRunningPayment] = useState(false);

  useEffect(() => {
    setForm({
      fetchDay: Number.isFinite(Number(settings?.fetchDay)) ? Number(settings.fetchDay) : 5,
      fetchHour: Number.isFinite(Number(settings?.fetchHour)) ? Number(settings.fetchHour) : 7,
      paymentConfirmationEnabled: Boolean(settings?.paymentConfirmationEnabled),
      paymentConfirmationDay: Number.isFinite(Number(settings?.paymentConfirmationDay)) ? Number(settings.paymentConfirmationDay) : 10,
      paymentConfirmationHour: Number.isFinite(Number(settings?.paymentConfirmationHour)) ? Number(settings.paymentConfirmationHour) : 8,
    });
  }, [settings]);

  useEffect(() => {
    if (onRefreshWorkerStatus) onRefreshWorkerStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    // Só os campos de cron — o backend faz merge e preserva credenciais/certificado.
    await onSave({
      fetchDay: form.fetchDay,
      fetchHour: form.fetchHour,
      paymentConfirmationEnabled: form.paymentConfirmationEnabled,
      paymentConfirmationDay: form.paymentConfirmationDay,
      paymentConfirmationHour: form.paymentConfirmationHour,
    });
  }

  async function handleRunPayment() {
    if (!onRunPaymentConfirmation) return;
    setRunningPayment(true);
    try {
      await onRunPaymentConfirmation();
    } finally {
      setRunningPayment(false);
    }
  }

  return (
    <PageShell
      title="Rotinas"
      subtitle="Agende os cron jobs do escritório e dispare execuções manuais."
      onBack={onBack}
    >
      <AppShell className="serpro-settings-shell">
        <div className="serpro-settings-page">
          <form onSubmit={handleSubmit}>
            {/* ── Cron de captura (extrato + DAS + INSS + LP) ── */}
            <section className="serpro-settings-card">
              <div className="serpro-settings-card__head">
                <h1 className="serpro-settings-card__title">Captura automática de guias</h1>
                <p className="serpro-settings-card__description">
                  Captura inicial (extrato + DAS + INSS) no dia/horário escolhidos e depois roda
                  diariamente até o vencimento de cada guia.
                </p>
              </div>

              <div className="serpro-settings-form__grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 180px" }}>
                <label>
                  Dia
                  <select
                    value={String(form.fetchDay)}
                    onChange={(event) => setField("fetchDay", Math.max(1, Math.min(31, Number(event.target.value) || 5)))}
                  >
                    {DAY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Horário
                  <input
                    type="time"
                    value={`${pad2(form.fetchHour)}:00`}
                    onChange={(event) => setField("fetchHour", Math.max(0, Math.min(23, Number(String(event.target.value || "07:00").split(":")[0]) || 7)))}
                  />
                </label>
              </div>

              <div className="serpro-settings-form__actions" style={{ marginTop: 16 }}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={runningCron}
                  onClick={() => onRunCron && onRunCron({})}
                >
                  {runningCron ? "Rodando captura…" : "Rodar captura agora"}
                </Button>
              </div>
            </section>

            {/* ── Cron de confirmação de pagamento (PAGTOWEB) ── */}
            <section className="serpro-settings-card">
              <div className="serpro-settings-card__head">
                <h2 className="serpro-settings-card__title">Confirmação de pagamento (PAGTOWEB)</h2>
                <p className="serpro-settings-card__description">
                  Consulta o comprovante oficial das guias em aberto, marca as pagas e gera a baixa
                  contábil. Requer o serviço PAGTOWEB validado no SERPRO.
                </p>
              </div>

              <label className="serpro-settings-form__switch">
                <input
                  type="checkbox"
                  style={{ width: 16, height: 16, flex: "none" }}
                  checked={form.paymentConfirmationEnabled}
                  onChange={(event) => setField("paymentConfirmationEnabled", event.target.checked)}
                />
                <span>Habilitar confirmação automática</span>
              </label>

              <div className="serpro-settings-form__grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 180px", marginTop: 12 }}>
                <label>
                  Dia
                  <select
                    value={String(form.paymentConfirmationDay)}
                    onChange={(event) => setField("paymentConfirmationDay", Math.max(1, Math.min(31, Number(event.target.value) || 10)))}
                    disabled={!form.paymentConfirmationEnabled}
                  >
                    {DAY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Horário
                  <input
                    type="time"
                    value={`${pad2(form.paymentConfirmationHour)}:00`}
                    onChange={(event) => setField("paymentConfirmationHour", Math.max(0, Math.min(23, Number(String(event.target.value || "08:00").split(":")[0]) || 8)))}
                    disabled={!form.paymentConfirmationEnabled}
                  />
                </label>
              </div>

              {onRunPaymentConfirmation && (
                <div className="serpro-settings-form__actions" style={{ marginTop: 16 }}>
                  <Button type="button" variant="secondary" disabled={runningPayment} onClick={handleRunPayment}>
                    {runningPayment ? "Consultando pagamentos…" : "Confirmar pagamentos agora"}
                  </Button>
                </div>
              )}
            </section>

            <div className="serpro-settings-form__actions">
              <Button type="submit" variant="success" disabled={saving}>
                {saving ? "Salvando..." : "Salvar rotinas"}
              </Button>
            </div>
          </form>

          {/* ── Status da última execução ── */}
          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h2 className="serpro-settings-card__title">Última execução</h2>
            </div>
            <div className="serpro-settings-status-grid">
              <div className="serpro-settings-status-item">
                <span>Worker</span>
                <strong>{workerStatus?.workerEnabled ? "Ativo" : "Inativo"}</strong>
              </div>
              <div className="serpro-settings-status-item">
                <span>Última captura</span>
                <strong>{formatDateTime(workerStatus?.lastRun?.updatedAt)}</strong>
              </div>
            </div>
            {cronRunResult && (
              <small style={{ color: "#69FF47", display: "block", marginTop: 12 }}>
                Execução manual concluída.
              </small>
            )}
          </section>

          <Feedback message={message} error={error} />
        </div>
      </AppShell>
    </PageShell>
  );
}
