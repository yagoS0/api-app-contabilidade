// O POP-UP DE GUIAS — a **camada 1** da `CONSTITUICAO-do-produto.md` §3: *"Tem algo pegando fogo?"*
//
// > `SPEC-fluxo-de-caixa-v3.md` §1: aparece quando existe guia vencida e não paga, ou com vencimento
// > em até 5 dias, **e** que ainda não foi confirmada. Sem guia nessas condições, ele não existe —
// > e **não há card fixo no lugar**.
//
// ⚠⚠ **"ESTOU CIENTE" NÃO PAGA NADA, E ESSA É A LINHA MAIS FINA DESTA TELA.** Ele grava
// `CienciaDeGuias` — *"eu vi o aviso"* — e nunca `paymentStatus`. A Lei 5 fecha a palavra: *Ciência
// nunca significa pagamento*. Um clique dado para dispensar um modal não pode tirar do contador a
// cobrança nem do cliente a dívida.
//
// ⚠⚠ **O `Esc` FECHA SEM GRAVAR** (v3 §1, explícito). A confirmação é só pelo botão — senão um
// toque de teclado para tirar o modal da frente silenciaria o aviso para sempre.
//
// ⚠ `role="alertdialog"`, e não `dialog`: ele interrompe para avisar de algo que já está errado.

import { useState } from "react";
import { api } from "../../api";
import { useDialogoModal } from "../../lib/hooks";
import { brl } from "../../lib/format";

/** ⚠ A data vem "AAAA-MM-DD" do servidor. Formatação por STRING — `new Date` deslocaria o fuso. */
function diaEMes(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}` : null;
}

/**
 * ⚠ As duas frases dizem coisas diferentes e têm CORES diferentes: vermelho é "vencido", âmbar é
 * "vai vencer". Constituição §5 — vermelho é exclusivo de vencido/negativo.
 */
function quandoVence(item) {
  const quando = diaEMes(item?.vencimento);
  if (item?.estado === "overdue") return quando ? `venceu em ${quando}` : "já venceu";
  return quando ? `vence em ${quando}` : "vence em breve";
}

export function PopUpDeGuias({ companyId, alerta, aoVerGuias, aoFechar, aoConfirmar }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  // ⚠ `escFecha` fecha a SESSÃO do pop-up, e é o `aoFechar` que corre — nunca o `aoConfirmar`.
  const { caixaRef } = useDialogoModal({ aoFechar, escFecha: !enviando });

  const itens = alerta?.itens || [];

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      await api.registrarCienciaDeGuias(companyId, { guiaIds: itens.map((i) => i.id) });
      aoConfirmar?.();
    } catch (e) {
      // ⚠⚠ FALHOU ⇒ O POP-UP **FICA**. Fechá-lo assim mesmo faria a pessoa achar que registrou, e o
      // aviso voltaria na próxima abertura sem explicação nenhuma.
      setErro(e);
      setEnviando(false);
    }
  }

  return (
    <div className="sobreposicao">
      <div
        className="pop-guias"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pop-guias-titulo"
        ref={caixaRef}
      >
        <h2 id="pop-guias-titulo">Você tem guias para pagar</h2>
        {/*
          ⚠⚠ A FRASE DIZ QUE CIÊNCIA NÃO PAGA (31/08/2026) — achado em teste de usabilidade.

          O texto era *"Este aviso volta a aparecer até que você ou seu contador confirmem"*, e
          **"confirmem" se lê como confirmar o PAGAMENTO** — o botão que tira a guia da frente com
          um clique. A Lei 5 fecha a palavra (*"Ciência nunca significa pagamento"*) e este arquivo
          já a chamava de *"a linha mais fina desta tela"*, mas só em COMENTÁRIO: nada disso chegava
          ao olho de quem clica.

          ⚠ `Guide.clienteConfirmouEm` guarda outro fato — *"eu paguei esta guia"*, e move
          `paymentStatus`. Um clique dado para dispensar um modal não pode tirar do contador a
          cobrança nem do cliente a dívida.
        */}
        <p className="meta meta--bloco">
          Confira antes de continuar. <strong>Marcar como ciente não paga nem baixa nada</strong> —
          é só para este aviso parar de aparecer. O pagamento continua em aberto até você pagar.
        </p>

        {itens.map((i) => (
          <div className="pop-guias-linha" key={i.id}>
            <span>
              {i.rotulo}
              {i.competencia ? ` · ${i.competencia}` : ""}
              {/* ⚠ O estado vai no DOM (`data-estado`), auditável, além da cor e da frase. */}
              <small className="pop-guias-quando" data-estado={i.estado}>{quandoVence(i)}</small>
            </span>
            <span className="pop-guias-valor">{brl(i.valor)}</span>
          </div>
        ))}

        <div className="pop-guias-soma">
          <span>Total</span>
          <span>{brl(alerta?.valor)}</span>
        </div>

        {erro ? (
          <p className="meta-erro">
            ⚠ Não foi possível registrar. O aviso continua aqui para você não perder a guia de vista.
          </p>
        ) : null}

        <div className="pop-guias-acoes">
          {/* ⚠ "Ver todas as guias" NAVEGA e fecha a sessão do pop-up — mas NÃO grava ciência: a
              pessoa foi olhar, não disse que está ciente. */}
          <button type="button" className="btn" onClick={aoVerGuias} disabled={enviando}>
            Ver todas as guias
          </button>
          <button type="button" className="btn btn-primary" onClick={confirmar} disabled={enviando}>
            {enviando ? "Registrando…" : "Estou ciente"}
          </button>
        </div>
      </div>
    </div>
  );
}
