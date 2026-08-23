import { AppShell } from "../../../../components/layout/AppShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { LogoAltan } from "../../../../components/ui/LogoAltan";

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
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 16 }}>
            {/* ⚠ Era `<h2 className="panel__title">Portal Firm</h2>` — o nome de scaffold, em
                inglês, na tela que o contador abre todo dia. O `<h2>` fica (é a hierarquia da
                página); quem dá o nome acessível agora é o `<title>` do SVG. */}
            <h2 className="panel__title" style={{ margin: 0, lineHeight: 0 }}>
              <LogoAltan altura={40} />
            </h2>
            {/* ⚠⚠ O MODO SÓ APARECE QUANDO É DEMONSTRAÇÃO — pedido do dono, 23/08/2026. Antes esta
                linha imprimia "Modo da API: real" para o usuário final: diagnóstico nosso vazando
                na tela de entrada, dizendo algo que só interessa a quem desenvolve.
                ⚠ E a comparação é `=== "mock"`, nunca `!== "real"`: os modos são TRÊS
                (`api/client.js`), e `real_with_mock_fallback` TENTA O REAL PRIMEIRO — chamá-lo de
                demonstração afirmaria o contrário do que está acontecendo. */}
            {apiMode === "mock" ? (
              <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Modo demonstração
              </p>
            ) : null}
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
