// O ÚNICO OVERLAY DO APP.
//
// ⚠ O QUE ISTO CONSERTA. Medido antes desta mudança: **43** blocos
// `position:"fixed", inset:0` escritos à mão em **33** arquivos, com doze larguras diferentes
// (400 · 420 · 460 · 480 · 520 · 560 · 620 · 640 · 720 · 760 · 780 · 900 · 1100) e — o que
// realmente custa — comportamentos diferentes:
//
//   - alguns fechavam no `Esc`, a maioria não;
//   - alguns fechavam no clique do fundo, inclusive DURANTE a gravação (perdendo o que estava
//     sendo salvo);
//   - quase nenhum devolvia o foco ao gatilho, e vários nem levavam o foco para dentro — quem
//     navega por teclado abria o diálogo e continuava tabulando a página ATRÁS dele.
//
// Três tamanhos, e o número mora aqui:
//   `sm` 460  — uma pergunta ("qual documento é este?", confirmar)
//   `md` 640  — um formulário curto (baixa, captura de guia)
//   `lg` 900  — uma tabela ou duas colunas (detalhe da nota, parcelamento)
//
// ⚠ TAMANHO INVÁLIDO CAI EM `md`, não em `lg`: diálogo maior que o necessário rouba a tela inteira
// e some com o contexto de onde a pessoa clicou.
import { useEffect, useRef } from "react";

const LARGURAS = { sm: 460, md: 640, lg: 900 };

const FOCAVEIS = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * @param {string}   titulo            Obrigatório — é o `aria-label` do diálogo e o que distingue
 *                                     dois modais abertos pelo mesmo botão.
 * @param {Function} aoFechar          Chamado por `Esc`, pelo fundo e pelo ✕.
 * @param {boolean}  [ocupado]         Gravando: `Esc` e o fundo param de fechar. ⚠ O ✕ TAMBÉM some
 *                                     — botão que não faz nada é pior que botão ausente.
 * @param {"sm"|"md"|"lg"} [tamanho]
 * @param {boolean} [lateral]        ⚠⚠ GAVETA: a mesma caixa colada na borda direita, da altura da
 *                                   tela. É variante do MESMO primitivo de propósito — Esc, clique
 *                                   no fundo, foco preso, foco de volta ao gatilho e o `ocupado`
 *                                   desligando as três saídas são exatamente os mesmos, e foi a
 *                                   ausência deles nos 43 overlays à mão que criou este arquivo.
 *                                   ⚠ Com `lateral`, `tamanho` é ignorado: a largura é da gaveta.
 * @param {import("react").ReactNode} [rodape]  Botões. A ação primária vai por último (à direita).
 */
export function Modal({
  titulo,
  aoFechar,
  ocupado = false,
  tamanho = "md",
  lateral = false,
  rodape = null,
  children,
}) {
  const caixaRef = useRef(null);
  const gatilhoRef = useRef(null);

  // ⚠ O foco entra ao abrir e VOLTA para quem abriu ao fechar. Sem a volta, fechar o diálogo joga
  // o foco no `<body>` e a próxima tecla do teclado não tem para onde ir — quem navega assim
  // recomeça a página do zero a cada modal.
  //
  // ⚠⚠ E ELE ENTRA NO CORPO, NÃO NO ✕. A primeira versão fazia `querySelector(FOCAVEIS)` na caixa
  // inteira, e `.modal-topo` vem antes de `.modal-corpo` — o primeiro focável era SEMPRE o botão
  // Fechar. Num diálogo que pergunta "qual documento é este?" isso põe o foco no botão que
  // DESCARTA a fila de arquivos, e um Enter reflexo joga fora o que a pessoa acabou de arrastar.
  // Pior: o `autoFocus` que o conteúdo declara roda antes deste efeito (fase de layout) e era
  // sobrescrito — o autor escrevia `autoFocus` e ele não fazia nada.
  //
  // A ordem é: o que pediu `autoFocus` → o primeiro focável do CORPO → a própria caixa.
  useEffect(() => {
    gatilhoRef.current = document.activeElement;
    const caixa = caixaRef.current;
    const corpo = caixa?.querySelector(".modal-corpo");
    const alvo = caixa?.querySelector("[autofocus]")
      || corpo?.querySelector(FOCAVEIS)
      || caixa?.querySelector(FOCAVEIS)
      || caixa;
    alvo?.focus?.();
    return () => gatilhoRef.current?.focus?.();
  }, []);

  useEffect(() => {
    function aoTeclar(e) {
      if (e.key === "Escape" && !ocupado) {
        e.stopPropagation();
        aoFechar?.();
        return;
      }
      // Prende o Tab dentro do diálogo: com `aria-modal` o leitor de tela já ignora o resto da
      // página, mas o foco do teclado continuaria passeando por trás do fundo escuro.
      if (e.key !== "Tab" || !caixaRef.current) return;
      const itens = Array.from(caixaRef.current.querySelectorAll(FOCAVEIS));
      // ⚠⚠ ZERO FOCÁVEIS NÃO É "DEIXA PASSAR" — é quando o trap MAIS importa. Acontece de verdade:
      // com `ocupado`, o ✕ some e os botões do rodapé ficam `disabled`, então a caixa fica sem
      // nenhum elemento focável e o navegador já jogou o foco no `<body>`. Deixar o Tab seguir
      // levaria o teclado para a página ATRÁS do overlay, no exato momento em que o diálogo
      // declara que as três saídas estão desligadas. Prende o foco na caixa (que tem
      // `tabIndex={-1}`) e engole o Tab.
      if (!itens.length) {
        e.preventDefault();
        caixaRef.current.focus?.();
        return;
      }
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar, true);
    return () => document.removeEventListener("keydown", aoTeclar, true);
  }, [aoFechar, ocupado]);

  const largura = LARGURAS[tamanho] || LARGURAS.md;

  return (
    <div
      className={`modal-fundo${lateral ? " modal-fundo--lateral" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={(e) => { if (e.target === e.currentTarget && !ocupado) aoFechar?.(); }}
    >
      {/* `tabIndex={-1}`: focável por código, nunca pela ordem de Tab. É o alvo de último recurso
          do foco inicial e o refúgio do trap quando não há nenhum elemento focável dentro. */}
      <div
        className={`modal-caixa${lateral ? " modal-caixa--lateral" : ""}`}
        /* ⚠ A gaveta NÃO leva `maxWidth` inline: a largura dela é da classe, e um valor aqui
           venceria a regra por especificidade — o defeito ficaria "a gaveta abre estreita no meio
           da tela", que é como um overlay à mão se parece. */
        style={lateral ? undefined : { maxWidth: largura }}
        ref={caixaRef}
        tabIndex={-1}
      >
        <div className="modal-topo">
          <strong className="modal-titulo">{titulo}</strong>
          {ocupado ? null : (
            <button type="button" className="modal-fechar" onClick={aoFechar} aria-label="Fechar">
              ✕
            </button>
          )}
        </div>

        <div className="modal-corpo">{children}</div>

        {rodape ? <div className="modal-rodape">{rodape}</div> : null}
      </div>
    </div>
  );
}

export default Modal;
