import { useState } from "react";
import { mensagemDeErro } from "../lib/mensagens";

/**
 * COPIAR — para a linha digitável da guia, que é o número que o cliente digita no banco.
 *
 * ⚠⚠ O RETORNO NÃO MENTE, e é a razão de este componente ter estado próprio em vez de ser um
 * `onClick` solto. `navigator.clipboard` NÃO EXISTE em contexto inseguro (`http://ip:porta`, que é
 * como o portal roda em rede local) e a chamada pode ser recusada mesmo onde existe. Nesses casos o
 * botão diz "não deu" — um "✓" falso faria o cliente colar o conteúdo ANTERIOR da área de
 * transferência no campo do banco, e ele não teria como saber.
 *
 * ⚠ Copia o VALOR CRU, nunca o formatado: são os 48 dígitos que se digitam.
 *
 * ⚠ Gêmeo de `apps/web/src/components/ui/BotaoCopiar.jsx` — MESMO comportamento, apps separados e
 * paletas diferentes (aqui a paleta é clara e os tokens são `--success`/`--danger`, não
 * `--state-ok`/`--state-danger`). Se o comportamento mudar num, tem de mudar no outro.
 */
export function BotaoCopiar({ valor, rotulo }) {
  const [estado, setEstado] = useState("parado"); // parado | copiado | falhou

  async function copiar() {
    const texto = String(valor || "");
    if (!texto) return;
    try {
      if (!navigator?.clipboard?.writeText) throw new Error("sem clipboard");
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      setEstado("falhou");
    }
    window.setTimeout(() => setEstado("parado"), 1600);
  }

  const rotuloVisivel = estado === "copiado" ? "Copiado" : estado === "falhou" ? "Não deu" : "Copiar";
  return (
    <button
      type="button"
      className="btn"
      onClick={copiar}
      aria-label={rotulo}
      title={
        estado === "falhou"
          ? "Não foi possível copiar neste navegador — selecione o número e copie à mão"
          : "Copiar os 48 dígitos, sem espaços — é o que se digita no banco"
      }
      style={{
        padding: "2px 8px",
        fontSize: ".78rem",
        color: estado === "copiado" ? "var(--success)" : estado === "falhou" ? "var(--danger)" : undefined,
      }}
    >
      {rotuloVisivel}
    </button>
  );
}

/**
 * Chip de status. Reusa o mapa de cores do protótipo (`data-status`), que é o
 * mesmo vocabulário do app mobile — web e mobile precisam pintar a mesma coisa
 * da mesma cor, senão o cliente aprende dois idiomas para um sistema só.
 */
export function Chip({ status, children, title, "aria-label": ariaLabel }) {
  return (
    <span className="chip" data-status={status || undefined} title={title || undefined} aria-label={ariaLabel || undefined}>
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
