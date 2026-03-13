import { AppShell } from "../../../components/layout/AppShell";
import { Feedback } from "../../../components/ui/Feedback";
import { Button } from "../../../components/ui/Button";

export function GuideSettingsPage({
  form,
  onChange,
  onSubmit,
  onBack,
  submitting,
  message,
  error,
}) {
  return (
    <AppShell>
      <header className="header inline-header">
        <div>
          <h1>Configuração de guias</h1>
          <p>Defina os IDs da pasta de entrada e da pasta raiz de saída no Google Drive.</p>
        </div>
        <Button variant="secondary" onClick={onBack}>
          Voltar
        </Button>
      </header>

      <section className="panel">
        <div className="inline-header">
          <h2>Pastas do Drive</h2>
        </div>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            ID da pasta Caixa de entrada
            <input
              value={form.guideDriveInboxId}
              onChange={(event) => onChange("guideDriveInboxId", event.target.value)}
              placeholder="Ex: 1AbCDefGhIJkLmNo"
            />
          </label>
          <label>
            ID da pasta de saída
            <input
              value={form.guideDriveOutputRootId}
              onChange={(event) => onChange("guideDriveOutputRootId", event.target.value)}
              placeholder="Ex: 2ZyXWvuTsRqPoNmL"
            />
          </label>
          <p className="hint">
            A pasta de saída é a raiz onde o backend organiza automaticamente as subpastas das empresas e
            competências.
          </p>
          <div className="form-actions">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : "Salvar configuração"}
            </Button>
          </div>
        </form>
        <Feedback message={message} error={error} />
      </section>
    </AppShell>
  );
}
