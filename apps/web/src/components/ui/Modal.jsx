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
 * @param {import("react").ReactNode} [rodape]  Botões. A ação primária vai por último (à direita).
 */
export function Modal({
  titulo,
  aoFechar,
  ocupado = false,
  tamanho = "md",
  rodape = null,
  children,
}) {
  const caixaRef = useRef(null);
  const gatilhoRef = useRef(null);

  // ⚠ O foco entra ao abrir e VOLTA para quem abriu ao fechar. Sem a volta, fechar o diálogo joga
  // o foco no `<body>` e a próxima tecla do teclado não tem para onde ir — quem navega assim
  // recomeça a página do zero a cada modal.
  useEffect(() => {
    gatilhoRef.current = document.activeElement;
    const alvo = caixaRef.current?.querySelector(FOCAVEIS) || caixaRef.current;
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
      if (!itens.length) return;
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
      className="modal-fundo"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={(e) => { if (e.target === e.currentTarget && !ocupado) aoFechar?.(); }}
    >
      <div className="modal-caixa" style={{ maxWidth: largura }} ref={caixaRef}>
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
