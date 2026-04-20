import { AppShell } from "../../../../components/layout/AppShell";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";

export function LoginPage({
  apiMode,
  identifier,
  password,
  onIdentifierChange,
  onPasswordChange,
  onSubmit,
  authLoading,
  error,
}) {
  return (
    <AppShell>
      <PageHeader title="Portal Firm" description={`Modo da API: ${apiMode}`} />
      <section className="panel">
        <h2 className="panel__title">Entrar</h2>
        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            E-mail ou usuário
            <input
              value={identifier}
              onChange={(e) => onIdentifierChange(e.target.value)}
              placeholder="admin@empresa.com"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <div className="form-actions">
            <Button type="submit" disabled={authLoading}>
              {authLoading ? "Entrando…" : "Entrar"}
            </Button>
          </div>
        </form>
        <Feedback error={error} />
      </section>
    </AppShell>
  );
}
