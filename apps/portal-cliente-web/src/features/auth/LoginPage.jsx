import { useState } from "react";
import { api } from "../../api";
import { definirSessao, reconhecerExpiracao } from "../../api/sessionStore";
import { mensagemDeErro } from "../../lib/mensagens";

/**
 * Entrada do portal do CLIENTE.
 *
 * Duas coisas que esta tela precisa dizer e quase nunca dizem:
 *  1. Por que a senha não passou — em português, nunca "erro 401".
 *  2. Que a sessão EXPIROU, quando foi o caso. Voltar ao login sem explicação é
 *     indistinguível de um app que desloga sozinho.
 */
export function LoginPage({ expirou, aoEsquecerSenha }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const demonstracao = api.mode === "mock";

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    reconhecerExpiracao(); // o aviso de expiração some assim que há nova tentativa
    setEnviando(true);
    try {
      const resposta = await api.login(email.trim(), senha);
      definirSessao({
        accessToken: resposta.accessToken,
        refreshToken: resposta.refreshToken,
        user: resposta.user,
      });
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível entrar. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={aoEnviar}>
        <h1>Portal do Cliente</h1>
        <p className="sub">Acompanhe suas notas, guias e impostos.</p>

        {expirou && !erro ? (
          <div className="alerta alerta-aviso" role="status" style={{ marginBottom: "var(--gap)" }}>
            <p>Sua sessão expirou. Entre novamente para continuar.</p>
          </div>
        ) : null}

        {erro ? (
          <div className="alerta alerta-erro" role="alert" style={{ marginBottom: "var(--gap)" }}>
            <p>
              <strong>Não foi possível entrar.</strong>
            </p>
            <p>{erro}</p>
          </div>
        ) : null}

        <label htmlFor="campo-email">
          E-mail
          <input
            id="campo-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label htmlFor="campo-senha">
          Senha
          <input
            id="campo-senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </label>

        <button className="btn btn-primary btn-block" type="submit" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>

        {/* ⚠ A saída para quem esqueceu a senha fica NA TELA DO ERRO, não escondida num rodapé:
            é exatamente aqui que a pessoa está quando descobre que não lembra. Até esta entrega
            não havia saída nenhuma — o cliente dependia de o escritório mexer no banco à mão. */}
        {aoEsquecerSenha ? (
          <p className="stack-gap" style={{ textAlign: "center" }}>
            <button type="button" className="btn-link" onClick={aoEsquecerSenha}>
              Esqueci minha senha
            </button>
          </p>
        ) : null}

        {demonstracao ? (
          <div className="alerta alerta-info stack-gap">
            <p>
              <strong>Modo demonstração.</strong> Os dados desta tela são fictícios e ficam no seu
              navegador — nenhuma informação real é lida ou enviada.
            </p>
            <p className="muted">
              Cliente: <code>cliente@exemplo.com</code> · senha <code>123456</code>
            </p>
          </div>
        ) : null}
      </form>
    </div>
  );
}
