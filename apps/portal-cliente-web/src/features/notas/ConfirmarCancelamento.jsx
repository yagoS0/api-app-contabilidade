import { useEffect, useRef, useState } from "react";
import { brl, fmtDateBr, fmtDoc, texto, TRACO } from "../../lib/format";
import {
  JUSTIFICATIVA,
  MOTIVOS_CANCELAMENTO,
  conferirFormulario,
  lerRecusaCancelamento,
} from "./lib/cancelamentoNota";

/**
 * ⚠⚠ A CONFIRMAÇÃO DE UM ATO IRREVERSÍVEL — e ela REPETE OS DADOS DA NOTA.
 *
 * *"Tem certeza?"* não é confirmação: é um obstáculo que se aprende a clicar sem ler, e quem
 * clica no botão da linha errada recebe exatamente a mesma pergunta que receberia na certa. O que
 * confirma é **ver de novo qual nota vai ser cancelada** — número, tomador, valor e data —, que
 * são os quatro campos pelos quais uma pessoa reconhece uma nota.
 *
 * ⚠ O BOTÃO QUE CANCELA NÃO É O PADRÃO DO DIÁLOGO: "Voltar" vem primeiro e o destrutivo é
 * nomeado pelo que faz ("Cancelar esta nota"), nunca "OK"/"Sim". Enter no formulário não dispara
 * o ato — o `type="submit"` fica com o botão destrutivo só depois de o formulário estar completo.
 *
 * ⚠⚠ O MÍNIMO DA JUSTIFICATIVA APARECE ANTES DE DIGITAR. É exigência do leiaute nacional
 * (`TSMotivo`, 15 a 255), e descobri-la como erro depois de clicar seria descobrir uma regra na
 * pior hora possível.
 */
export function ConfirmarCancelamento({ nota, aoFechar, aoConfirmar }) {
  const [cMotivo, setCMotivo] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState(null);
  const caixaRef = useRef(null);

  useEffect(() => {
    const aoTeclar = (e) => {
      if (e.key === "Escape" && !enviando) aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    caixaRef.current?.focus();
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, enviando]);

  const conferencia = conferirFormulario({ cMotivo, justificativa });
  const restam = JUSTIFICATIVA.MIN - String(justificativa).trim().length;

  // ⚠⚠ `podeTentarDeNovo === false` DESABILITA O BOTÃO — e o caso que importa é o TRANSPORTE:
  // o pedido saiu, a resposta não voltou, e a nota PODE estar cancelada. Reenviar produz uma
  // recusa do sistema nacional que se lê como "falhou", quando tinha dado certo.
  const travadoPorDesfecho = recusa?.podeTentarDeNovo === false;
  const podeEnviar = conferencia.ok && !enviando && !travadoPorDesfecho;

  async function confirmar() {
    if (!podeEnviar) return;
    setEnviando(true);
    setRecusa(null);
    try {
      await aoConfirmar({ cMotivo, justificativa: String(justificativa).trim() });
      // Quem fecha e recarrega a lista é a página — o desfecho feliz não mora aqui.
    } catch (err) {
      setRecusa(lerRecusaCancelamento(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) aoFechar();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-cancelar-nota"
        tabIndex={-1}
        ref={caixaRef}
      >
        <h2 id="titulo-cancelar-nota">Cancelar esta nota</h2>

        {/* ⚠⚠ OS QUATRO CAMPOS PELOS QUAIS SE RECONHECE UMA NOTA. Isto é a confirmação. */}
        <dl className="dados-da-nota">
          <div>
            <dt>Número</dt>
            <dd>{texto(nota.numero)}</dd>
          </div>
          <div>
            <dt>Tomador</dt>
            <dd>
              {texto(nota.tomador?.nome)}
              {nota.tomador?.cnpjCpf ? ` · ${fmtDoc(nota.tomador.cnpjCpf)}` : ""}
            </dd>
          </div>
          <div>
            <dt>Valor</dt>
            <dd>{nota.total == null ? TRACO : brl(nota.total)}</dd>
          </div>
          <div>
            <dt>Emissão</dt>
            <dd>{fmtDateBr(nota.issueDate)}</dd>
          </div>
        </dl>

        <p className="hint">
          <strong>A nota cancelada não volta.</strong> O cancelamento é registrado no sistema
          nacional e a nota deixa de valer.
        </p>

        <label htmlFor="cancelar-motivo">
          Motivo do cancelamento
          <select
            id="cancelar-motivo"
            value={cMotivo}
            disabled={enviando || travadoPorDesfecho}
            onChange={(e) => setCMotivo(e.target.value)}
          >
            {/* ⚠ SEM PRÉ-SELEÇÃO. O motivo é declaração fiscal; escolher um por padrão faria o
                sistema declarar por quem cancela — foi exatamente o defeito do `cMotivo || "1"`
                que o backend tinha. */}
            <option value="">Escolha…</option>
            {MOTIVOS_CANCELAMENTO.map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.rotulo}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="cancelar-justificativa">
          Justificativa
          <textarea
            id="cancelar-justificativa"
            rows={3}
            value={justificativa}
            maxLength={JUSTIFICATIVA.MAX}
            disabled={enviando || travadoPorDesfecho}
            onChange={(e) => setJustificativa(e.target.value)}
          />
        </label>
        {/* ⚠ O MÍNIMO É DITO ANTES DE DIGITAR, e vira contagem enquanto falta. */}
        <span className="hint">
          {restam > 0
            ? `Mínimo de ${JUSTIFICATIVA.MIN} caracteres — faltam ${restam}.`
            : `Mínimo de ${JUSTIFICATIVA.MIN} caracteres — atendido.`}
        </span>

        {recusa ? (
          <div className="alerta alerta-erro" role="alert">
            <p>
              <strong>{recusa.titulo}</strong>
            </p>
            <p>{recusa.texto}</p>
            {recusa.porQue ? <p>{recusa.porQue}</p> : null}
            {recusa.motivosAceitos?.length ? (
              <p>
                Motivos aceitos: {recusa.motivosAceitos.map((m) => m.rotulo).join(" · ")}.
              </p>
            ) : null}
          </div>
        ) : null}

        <footer>
          <button type="button" className="btn" onClick={aoFechar} disabled={enviando}>
            {travadoPorDesfecho ? "Fechar" : "Voltar"}
          </button>
          {/* ⚠ O destrutivo é NOMEADO pelo que faz, e some quando não há mais o que tentar. */}
          {travadoPorDesfecho ? null : (
            <button
              type="button"
              className="btn btn-perigo"
              disabled={!podeEnviar}
              onClick={confirmar}
            >
              {enviando ? "Cancelando…" : "Cancelar esta nota"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
