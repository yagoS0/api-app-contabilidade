import { useSessao } from "./lib/hooks";
import { LoginPage } from "./features/auth/LoginPage";
import { AppShell } from "./features/shell/AppShell";

/**
 * Despacho de nível mais alto: com token, a casca; sem token, o login.
 *
 * A sessão é lida do store (`api/sessionStore`), não de um estado local — assim
 * quando o `realApi` derruba a sessão no meio de uma requisição (refresh
 * falhou), a tela reage sozinha e volta ao login COM o aviso, em vez de ficar
 * numa página que não carrega mais nada.
 */
export default function App() {
  const sessao = useSessao();

  if (!sessao.accessToken) {
    return <LoginPage expirou={sessao.expirou} />;
  }

  return <AppShell user={sessao.user} />;
}
