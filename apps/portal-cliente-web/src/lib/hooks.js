import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { assinarSessao, lerSessao } from "../api/sessionStore";

/** A sessão como estado de React, sem duplicar a fonte da verdade. */
export function useSessao() {
  return useSyncExternalStore(assinarSessao, lerSessao, lerSessao);
}

/**
 * Carregamento assíncrono com cancelamento.
 *
 * ⚠ O `descartado` não é cosmético: ao trocar de empresa, a requisição da
 * empresa ANTERIOR pode responder depois da nova. Sem a guarda, a tela mostraria
 * os números de uma empresa sob o nome de outra — que é o pior desfecho possível
 * num portal multi-empresa.
 *
 * `deps` segue a mesma regra do useEffect: mudou, recarrega.
 */
export function useCarregamento(fn, deps, { habilitado = true } = {}) {
  const [estado, setEstado] = useState({ dados: null, carregando: habilitado, erro: null });
  const [gatilho, setGatilho] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!habilitado) {
      setEstado({ dados: null, carregando: false, erro: null });
      return undefined;
    }
    let descartado = false;
    setEstado((anterior) => ({ ...anterior, carregando: true, erro: null }));
    Promise.resolve()
      .then(() => fnRef.current())
      .then((dados) => {
        if (!descartado) setEstado({ dados, carregando: false, erro: null });
      })
      .catch((erro) => {
        if (!descartado) setEstado({ dados: null, carregando: false, erro });
      });
    return () => {
      descartado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado, gatilho, ...deps]);

  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);
  return { ...estado, recarregar };
}

// ⚠ "emitir" SAIU DAQUI EM 19/08/2026 — pedido do dono: emitir deixou de ser aba e virou um botão
// DENTRO de Notas. A remoção é INTEIRA (menu, destino de rota e estado), de propósito: uma rota que
// ninguém mais alcança pelo menu, mas que o hash ainda aceita, é o "filtro fantasma" — alguém volta
// nela por um link antigo e cai numa tela que o app já não sabe fechar. `#/emitir` hoje cai no
// destino padrão, que é o comportamento de qualquer hash desconhecido.
const ROTAS = ["home", "notas", "guias", "fiscal"];
const ROTA_PADRAO = "home";

function rotaDaUrl() {
  const bruta = String(window.location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return ROTAS.includes(bruta) ? bruta : ROTA_PADRAO;
}

/**
 * Roteamento por hash — 20 linhas em vez de uma dependência.
 * Serve ao que o cliente espera do navegador: botão Voltar e link colável.
 */
export function useRota() {
  const [rota, setRota] = useState(rotaDaUrl);

  useEffect(() => {
    const aoMudar = () => setRota(rotaDaUrl());
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  const navegar = useCallback((destino) => {
    const alvo = ROTAS.includes(destino) ? destino : ROTA_PADRAO;
    window.location.hash = `#/${alvo}`;
  }, []);

  return { rota, navegar };
}

/**
 * ⚠⚠ O DIÁLOGO MODAL — Esc, foco que ENTRA, foco que NÃO SAI, e foco que VOLTA.
 *
 * Os três diálogos deste app (`SeletorEmpresa`, `ConfirmarCancelamento`, `PainelDoDia`) já
 * declaravam `role="dialog"` + `aria-modal="true"`, mandavam o foco para a caixa e fechavam no Esc —
 * cada um com a MESMA cópia do mesmo `useEffect`. **Faltava a metade que o `aria-modal` PROMETE:**
 * com Tab, o foco saía da caixa e ia passear pela página atrás, que continua inteira no DOM.
 *
 * ⚠ Isso não é preciosismo de acessibilidade: `aria-modal="true"` **afirma ao leitor de tela que o
 * resto da página está inerte**. Quem navega por teclado saía do diálogo sem saber, continuava
 * ouvindo "página atrás" com o diálogo aberto por cima, e — no caso do cancelamento — podia acionar
 * um botão da LISTA enquanto confirmava o cancelamento de uma nota fiscal. A promessa estava escrita
 * no atributo e não estava implementada em lugar nenhum.
 *
 * ⚠⚠ **ISTO É UM HOOK, E NÃO O `Dialogo` COMUM QUE O `CLAUDE.md` NOMEIA COMO PRÓXIMO PASSO.** A
 * diferença é deliberada: extrair o componente mexeria no MARKUP do `ConfirmarCancelamento`, que é o
 * fluxo de cancelamento de nota fiscal — e é exatamente a razão registrada lá para aquilo ser commit
 * separado. Um hook troca o `useEffect` de cada um e **não toca em uma linha de JSX**. O passo
 * nomeado continua nomeado; o que não podia continuar era a promessa não cumprida em três cópias.
 *
 * @param {object} opcoes
 * @param {() => void} opcoes.aoFechar      o que o Esc chama
 * @param {boolean}   [opcoes.escFecha]     `false` enquanto o Esc não pode fechar (envio em curso)
 * @returns {{caixaRef: import("react").RefObject<HTMLElement>}}
 */
export function useDialogoModal({ aoFechar, escFecha = true }) {
  const caixaRef = useRef(null);

  useEffect(() => {
    const caixa = caixaRef.current;
    // ⚠ Guardado ANTES de mover o foco: é para cá que ele volta quando o diálogo fecha. Sem isso,
    // fechar o diálogo devolve o foco ao `<body>` e quem usa teclado recomeça do topo da página.
    const focoAnterior = typeof document !== "undefined" ? document.activeElement : null;

    /**
     * ⚠ A lista é calculada A CADA Tab, nunca na montagem. O conteúdo destes diálogos MUDA com o
     * uso: o `ConfirmarCancelamento` habilita o botão de enviar conforme a justificativa cresce, e
     * o `PainelDoDia` desabilita ‹ › nas bordas do mês. Uma lista congelada mandaria o foco para um
     * botão desabilitado — que não o aceita — e o Tab pareceria morto.
     */
    const focaveis = () => {
      if (!caixa) return [];
      const alvos = caixa.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      return [...alvos].filter((el) => !el.disabled && el.getAttribute("aria-hidden") !== "true");
    };

    const aoTeclar = (e) => {
      if (e.key === "Escape") {
        if (escFecha) aoFechar();
        return;
      }
      if (e.key !== "Tab" || !caixa) return;

      const lista = focaveis();
      // ⚠ Diálogo sem nada focável dentro: o foco fica na CAIXA (que é `tabIndex={-1}`) e o Tab não
      // faz nada. Deixá-lo escapar seria pior — não haveria caminho de volta a não ser o Esc.
      if (!lista.length) {
        e.preventDefault();
        caixa.focus();
        return;
      }

      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      const atual = document.activeElement;

      // ⚠⚠ `atual === caixa` PRECISA ENTRAR AQUI, e é um buraco fácil de deixar: `contains` inclui
      // o próprio nó, então tratar só `!contains` deixaria o foco na caixa cair fora deste ramo — e
      // aí o **Shift+Tab** sairia do diálogo para trás, para a página que o `aria-modal` declara
      // inerte. O Tab para a FRENTE parecia certo (o navegador já iria para o primeiro de dentro), e
      // é por isso que o furo só apareceria no sentido que quase ninguém testa.
      if (!caixa.contains(atual) || atual === caixa) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primeiro).focus();
        return;
      }
      if (e.shiftKey && atual === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && atual === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };

    window.addEventListener("keydown", aoTeclar);
    caixa?.focus();

    return () => {
      window.removeEventListener("keydown", aoTeclar);
      // ⚠ Só devolve o foco se ele ainda estiver DENTRO do diálogo (ou em lugar nenhum). Se a página
      // já o moveu para outro lugar — a `NotasPage` recarrega a lista ao cancelar — roubá-lo de
      // volta seria pior que não devolver.
      const saindo = document.activeElement;
      const aindaDentro = !saindo || saindo === document.body || (caixa && caixa.contains(saindo));
      if (aindaDentro && focoAnterior && typeof focoAnterior.focus === "function") {
        focoAnterior.focus();
      }
    };
  }, [aoFechar, escFecha]);

  return { caixaRef };
}
