import { useState } from "react";
import { api } from "../../api";
import { mensagemDeErro } from "../../lib/mensagens";

// Mesma política do backend (`apps/api/src/application/validators/passwordPolicy.js`): 8 +
// minúscula + maiúscula + número + especial.
//
// ⚠ Esta lista é DICA, não autorização. Quem recusa senha fraca é o servidor — a cópia aqui existe
// só para o usuário saber a regra ANTES de digitar. Uma tela que esconde a regra e só a revela no
// erro faz a pessoa tentar três vezes às cegas, e é aí que ela escolhe algo memorável e ruim.
const REGRAS = [
  "pelo menos 8 caracteres",
  "uma letra minúscula",
  "uma letra maiúscula",
  "um número",
  "um caractere especial",
];

/**
 * Redefinição de senha — alcançada pelo link do e-mail, com o token na URL.
 *
 * ⚠ A RECUSA É UMA SÓ. Token inexistente, adulterado, VENCIDO e JÁ USADO chegam aqui como o mesmo
 * `invalid_token`, sem motivo anexo, porque o servidor não manda motivo: dizer "este link já foi
 * usado" confirmaria a quem chutou o token que ele existiu — e portanto que a conta existe.
 * A tela não tem a informação para ser mais específica, e não deve inventá-la. O que ela PODE
 * fazer, e faz, é oferecer o conserto: pedir um link novo.
 */
export function RedefinirSenhaPage({ token, aoConcluir }) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);

    // Conferido no cliente porque é o único erro que a tela SABE sozinha — e mandá-lo ao servidor
    // só para receber a mesma resposta seria uma ida de rede para nada.
    if (senha !== confirmacao) {
      setErro("As duas senhas não são iguais.");
      return;
    }

    setEnviando(true);
    try {
      await api.redefinirSenha(token, senha);
      setPronto(true);
    } catch (err) {
      setErro(mensagemDeErro(err, "Não foi possível redefinir a senha. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  }

  if (!token) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Link incompleto</h1>
          <div className="alerta alerta-erro" role="alert">
            <p>Este endereço não traz o código de redefinição.</p>
            <p>Abra o link exatamente como ele veio no e-mail, ou peça um novo.</p>
          </div>
          <p className="stack-gap">
            <button type="button" className="btn-link" onClick={aoConcluir}>
              Pedir um novo link
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (pronto) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Senha alterada</h1>
          <div className="alerta alerta-info" role="status">
            <p>
              <strong>Pronto.</strong> Sua senha foi alterada.
            </p>
            {/* ⚠ Isto NÃO é detalhe técnico: é a promessa que a tela precisa cumprir. Quem redefine
                a senha porque desconfia de invasão precisa saber que o invasor foi desconectado —
                senão a tela prometeria segurança que não entrega. O servidor revoga todas as
                `ClientSession` no mesmo commit da troca. */}
            <p className="muted">
              Por segurança, todos os dispositivos conectados a esta conta foram desconectados.
              Entre novamente com a senha nova.
            </p>
          </div>
          <p className="stack-gap">
            <button type="button" className="btn btn-primary btn-block" onClick={aoConcluir}>
              Ir para o login
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={aoEnviar}>
        <h1>Criar uma nova senha</h1>
        <p className="sub">Escolha uma senha que você não use em outro site.</p>

        {erro ? (
          <div className="alerta alerta-erro" role="alert" style={{ marginBottom: "var(--gap)" }}>
            <p>
              <strong>Não foi possível redefinir.</strong>
            </p>
            <p>{erro}</p>
            <p>
              <button type="button" className="btn-link" onClick={aoConcluir}>
                Pedir um novo link
              </button>
            </p>
          </div>
        ) : null}

        <label htmlFor="campo-senha-nova">
          Nova senha
          <input
            id="campo-senha-nova"
            type="password"
            autoComplete="new-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </label>

        <label htmlFor="campo-senha-confirmacao">
          Repita a nova senha
          <input
            id="campo-senha-confirmacao"
            type="password"
            autoComplete="new-password"
            required
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
          />
        </label>

        <div className="alerta alerta-info" style={{ margin: "var(--gap) 0" }}>
          <p className="muted" style={{ margin: 0 }}>
            A senha precisa ter: {REGRAS.join(", ")}.
          </p>
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>
    </div>
  );
}
