import { useState } from "react";
import { api } from "../../api";
import { mensagemDeErro } from "../../lib/mensagens";

/**
 * "Esqueci minha senha" — pedir o link.
 *
 * ⚠⚠ A CONFIRMAÇÃO NÃO PODE REVELAR SE A CONTA EXISTE. Esta é a regra da tela, e ela é fácil de
 * quebrar sem querer: a versão "natural" desta página diria "enviamos um e-mail para você" — o que
 * afirma que a conta existe — ou pior, "não encontramos esse e-mail". Num portal contábil isso
 * deixa qualquer um descobrir, endereço por endereço, QUEM É CLIENTE DE QUAL ESCRITÓRIO.
 *
 * Por isso a mensagem é sempre a CONDICIONAL: "se houver conta com esse e-mail, enviamos as
 * instruções". O servidor já responde igual nos dois casos (`POST /auth/forgot-password`); a tela
 * não teria como distinguir mesmo que quisesse — e este comentário existe para que ninguém
 * "conserte" isso depois achando que é vaguidão desnecessária.
 */
export function EsqueciSenhaPage({ aoVoltar }) {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [pedido, setPedido] = useState(false);

  const demonstracao = api.mode === "mock";

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.solicitarRedefinicao(email.trim());
      setPedido(true);
    } catch (err) {
      // ⚠ Só chega aqui o que NÃO é sobre a conta: mailer fora do ar (503), rede, rate limit.
      // "E-mail não existe" nunca é erro — é o mesmo sucesso.
      setErro(mensagemDeErro(err, "Não foi possível enviar as instruções. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  }

  if (pedido) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Verifique seu e-mail</h1>

          {/* ⚠ `alerta-info`, não um "sucesso" verde: a tela NÃO está confirmando que o e-mail
              saiu — está enunciando uma condição. A cor precisa contar a mesma história que o
              texto, senão o verde afirma o que a frase se recusa a afirmar. */}
          <div className="alerta alerta-info" role="status">
            <p>
              <strong>Se houver uma conta com esse e-mail, enviamos as instruções</strong> para
              redefinir a senha.
            </p>
            <p className="muted">
              O link vale por 60 minutos e só pode ser usado uma vez. Se não chegar em alguns
              minutos, confira a caixa de spam.
            </p>
          </div>

          {demonstracao ? (
            <div className="alerta alerta-aviso stack-gap">
              <p>
                <strong>Modo demonstração.</strong> Nenhum e-mail é enviado. Abra a tela de
                redefinição por um destes endereços para exercer cada desfecho:
              </p>
              <p className="muted">
                <code>?token=token-valido</code> · <code>?token=token-expirado</code> ·{" "}
                <code>?token=token-usado</code>
              </p>
            </div>
          ) : null}

          <p className="stack-gap">
            <button type="button" className="btn-link" onClick={aoVoltar}>
              Voltar para o login
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={aoEnviar}>
        <h1>Esqueci minha senha</h1>
        <p className="sub">
          Informe o e-mail do seu acesso. Enviaremos um link para você criar uma nova senha.
        </p>

        {erro ? (
          <div className="alerta alerta-erro" role="alert" style={{ marginBottom: "var(--gap)" }}>
            <p>
              <strong>Não foi possível enviar.</strong>
            </p>
            <p>{erro}</p>
          </div>
        ) : null}

        <label htmlFor="campo-email-recuperacao">
          E-mail
          <input
            id="campo-email-recuperacao"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <button className="btn btn-primary btn-block" type="submit" disabled={enviando}>
          {enviando ? "Enviando…" : "Enviar instruções"}
        </button>

        <p className="stack-gap" style={{ textAlign: "center" }}>
          <button type="button" className="btn-link" onClick={aoVoltar}>
            Voltar para o login
          </button>
        </p>
      </form>
    </div>
  );
}
