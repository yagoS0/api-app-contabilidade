import { AppShell } from "../../../../components/layout/AppShell";
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
      {/* Login centralizado vertical + horizontalmente, card compacto */}
      <div style={{
        minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <section className="panel" style={{ width: "100%", maxWidth: 360, margin: 0 }}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <h2 className="panel__title" style={{ margin: 0 }}>Portal Firm</h2>
            <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Modo da API: {apiMode}
            </p>
          </div>
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
            <div className="form-actions" style={{ justifyContent: "stretch" }}>
              <Button type="submit" disabled={authLoading} style={{ width: "100%" }}>
                {authLoading ? "Entrando…" : "Entrar"}
              </Button>
            </div>
          </form>
          <Feedback error={error} />
        </section>
      </div>
    </AppShell>
  );
}
