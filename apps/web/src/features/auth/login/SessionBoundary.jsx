import { useLocation } from "react-router-dom";
import { modoAtendimento } from "../../whatsapp/lib/atendimentoPwa";
import { useManageAppFeedback } from "../../../app/hooks/useManageAppFeedback";
import { useManageAuthSession } from "../../../app/hooks/useManageAuthSession";
import { LoginPage } from "./pages/renderLoginPage";
import { OfficeNavigation } from "../../../app/navigation/OfficeNavigation";
import { useResumoWhatsapp } from "../../whatsapp/hooks/useResumoWhatsapp";

function OfficeWorkspace({ api, children }) {
  const resumoWhatsapp = useResumoWhatsapp({ api });
  return <div className="office-workspace">
    <OfficeNavigation resumoWhatsapp={resumoWhatsapp} />
    <div className="office-workspace__content">{children}</div>
  </div>;
}

function AuthenticatedWorkspace({ api, children }) {
  const location = useLocation();
  return modoAtendimento(location) ? <div className="atendimento-workspace">{children}</div> : <OfficeWorkspace api={api}>{children}</OfficeWorkspace>;
}
// A área privada (inclusive seus hooks de dados) só monta após /auth/me confirmar a sessão.
export function SessionBoundary({ api, tokenStorageKey, children }) {
  const feedback = useManageAppFeedback();
  const session = useManageAuthSession({ api, tokenStorageKey, feedback });

  if (session.sessionChecking) {
    return <main className="page"><p role="status">Verificando sessão…</p></main>;
  }
  if (session.sessionError) return <main className="page"><p role="alert">{session.sessionError}</p><button type="button" onClick={session.retrySession}>Tentar novamente</button></main>;
  if (!session.user || session.page === "login") {
    return <LoginPage
      apiMode={api.mode}
      identifier={session.loginIdentifier}
      password={session.loginPassword}
      onIdentifierChange={session.setLoginIdentifier}
      onPasswordChange={session.setLoginPassword}
      onSubmit={session.handleLogin}
      authLoading={session.authLoading}
      error={feedback.error}
    />;
  }
  return <AuthenticatedWorkspace api={api}>{children(session, feedback)}</AuthenticatedWorkspace>;
}
