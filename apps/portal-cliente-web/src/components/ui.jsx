import { mensagemDeErro } from "../lib/mensagens";

/**
 * Chip de status. Reusa o mapa de cores do protótipo (`data-status`), que é o
 * mesmo vocabulário do app mobile — web e mobile precisam pintar a mesma coisa
 * da mesma cor, senão o cliente aprende dois idiomas para um sistema só.
 */
export function Chip({ status, children }) {
  return (
    <span className="chip" data-status={status || undefined}>
      {children}
    </span>
  );
}

/** Estado vazio. Diz o que está vazio, não só "sem dados". */
export function Vazio({ children }) {
  return <p className="empty">{children}</p>;
}

export function Carregando({ children = "Carregando…" }) {
  return (
    <p className="empty" role="status">
      {children}
    </p>
  );
}

/**
 * Erro em linguagem de gente. ⚠ Nunca imprime `err.message` cru: mensagem de
 * servidor é texto técnico, e numa tela de cliente ela só ensina que algo
 * quebrou sem dizer o que fazer.
 */
export function AlertaErro({ erro, padrao, aoTentarNovamente }) {
  if (!erro) return null;
  return (
    <div className="alerta alerta-erro" role="alert">
      <p>{mensagemDeErro(erro, padrao)}</p>
      {aoTentarNovamente ? (
        <p>
          <button type="button" className="btn-link" onClick={aoTentarNovamente}>
            Tentar de novo
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** Cartão de número do resumo. `apoio` é a linha que explica o número. */
export function CardNumero({ rotulo, valor, apoio, destaque = false }) {
  return (
    <div className="card">
      <div className="rotulo">{rotulo}</div>
      <div className={destaque ? "numero destaque" : "numero"}>{valor}</div>
      {apoio ? <div className="apoio">{apoio}</div> : null}
    </div>
  );
}
