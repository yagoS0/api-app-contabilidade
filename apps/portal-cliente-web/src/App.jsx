import { useState } from "react";
import { useSessao } from "./lib/hooks";
import { LoginPage } from "./features/auth/LoginPage";
import { EsqueciSenhaPage } from "./features/auth/EsqueciSenhaPage";
import { RedefinirSenhaPage } from "./features/auth/RedefinirSenhaPage";
import { AppShell } from "./features/shell/AppShell";
import { limparSessao } from "./api/sessionStore";

/**
 * Despacho de nível mais alto: com token, a casca; sem token, o login.
 *
 * A sessão é lida do store (`api/sessionStore`), não de um estado local — assim
 * quando o `realApi` derruba a sessão no meio de uma requisição (refresh
 * falhou), a tela reage sozinha e volta ao login COM o aviso, em vez de ficar
 * numa página que não carrega mais nada.
 */

/**
 * A redefinição de senha chega por URL (`/redefinir-senha?token=…`), que é a única entrada do app
 * que não parte de um clique dentro dele — o link vem do e-mail.
 *
 * ⚠ Lido UMA VEZ, na carga, e não a cada render: o token sai da URL e vira estado. Não há router
 * neste app (é React puro, sem dependência de roteamento), então este é o despacho inteiro.
 */
function rotaInicial() {
  try {
    const { pathname, search } = window.location;
    if (!/\/redefinir-senha\/?$/.test(pathname)) return null;
    return { token: new URLSearchParams(search).get("token") || "" };
  } catch {
    return null;
  }
}

export default function App() {
  const sessao = useSessao();
  const [redefinicao, setRedefinicao] = useState(rotaInicial);
  const [pedindoLink, setPedindoLink] = useState(false);

  // ⚠ A REDEFINIÇÃO VEM ANTES DA SESSÃO, de propósito. Quem clica no link do e-mail pode ter uma
  // sessão velha guardada neste navegador — inclusive a do invasor de quem ele está fugindo.
  // Mandá-lo para o app "porque já está logado" engoliria o link silenciosamente, justamente no
  // caso em que ele mais precisa funcionar.
  if (redefinicao) {
    return (
      <RedefinirSenhaPage
        token={redefinicao.token}
        /* ⚠ SAÍDA PRÓPRIA: leva ao formulário de recuperação, não ao login. Antes os dois botões
           "Pedir um novo link" chamavam o `aoConcluir` — que é a saída de QUEM JÁ TROCOU a senha. */
        aoPedirNovoLink={() => {
          try {
            window.history.replaceState({}, "", "/");
          } catch {
            // Sem History API o app segue — só a URL fica feia.
          }
          setRedefinicao(null);
          setPedindoLink(true);
        }}
        aoConcluir={() => {
          // A troca de senha revogou as sessões no servidor; a local não vale mais nada.
          limparSessao();
          // Tira o token da barra de endereços: link de redefinição não deve sobreviver no
          // histórico do navegador nem ser recarregado por F5 depois de consumido.
          try {
            window.history.replaceState({}, "", "/");
          } catch {
            // Sem History API o app segue — só a URL fica feia.
          }
          setRedefinicao(null);
          setPedindoLink(false);
        }}
      />
    );
  }

  if (!sessao.accessToken) {
    if (pedindoLink) {
      return <EsqueciSenhaPage aoVoltar={() => setPedindoLink(false)} />;
    }
    return <LoginPage expirou={sessao.expirou} aoEsquecerSenha={() => setPedindoLink(true)} />;
  }

  return <AppShell user={sessao.user} />;
}
