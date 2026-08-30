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

  // ⚠ O `stopPropagation` do original faltava aqui, e ele **não é decoração**: desde 23/08/2026
  // este app tem linha de tabela clicável (o fluxo de caixa do Painel). Hoje o botão só vive na
  // tabela de Guias, que não é clicável — mas o dia em que ele entrar numa que seja, "copiar a
  // linha digitável" passaria a abrir a linha junto, e o defeito apareceria na tela de outra
  // pessoa, não na de quem moveu o botão.
  async function copiar(e) {
    e?.stopPropagation?.();
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
/**
 * ⚠⚠ `status` ENTROU EM 28/08/2026, E ELE CONSERTA UMA AFIRMAÇÃO FALSA.
 *
 * O card de imposto mostrava **R$ 5.269,55** com o mesmo peso de um valor liquidado — e o número
 * era a soma de duas guias EM ABERTO. Medido na tela: ao lado dele, a frase de apoio dizia
 * *"Nenhuma guia paga nesta competência ainda"*. O card se contradizia.
 *
 * ⚠ A `CONSTITUICAO-do-produto.md` §1 manda que a distinção **nunca seja só cor**: âmbar vem com
 * itálico, `data-status` no DOM e nome acessível. São os MESMOS três canais das células da tabela —
 * um card com regra própria divergiria da linha que mostra o mesmo número.
 *
 * ⚠ `status` ausente ⇒ o card fica exatamente como era. Nenhum dos outros precisou mudar.
 */
export function CardNumero({ rotulo, valor, apoio, destaque = false, status = null }) {
  const previsto = status === "forecast";
  return (
    <div className="card">
      <div className="rotulo">{rotulo}</div>
      <div
        className={destaque ? "numero destaque" : "numero"}
        data-status={status || undefined}
        aria-label={previsto ? `${valor}, previsto` : undefined}
      >
        {valor}
      </div>
      {apoio ? <div className="apoio">{apoio}</div> : null}
    </div>
  );
}
