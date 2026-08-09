// Status do funil → como ele aparece na tela.
//
// ⚠ ÍCONE ALÉM DA COR, EM TODOS. Cor sozinha não é acessível e some numa impressão em preto e
// branco; e o quadro é lido de relance, de longe.
//
// ⚠ A ESCOLHA DOS TOKENS SEGUE A REGRA DE OURO DO `tokens.css`: cor forte = precisa de ação AGORA.
// - `RECEBIDO` é literalmente "ação rápida disponível" (alguém precisa pegar) → `--state-warn`.
// - `EM_TRILHA` é o estado normal e majoritário → NEUTRO. Colorir o normal faz o RECEBIDO parar de
//   se destacar, que é exatamente o problema que a tela de Empresas já teve (âmbar em 29 de 30).
// - `DESISTIU` usa `--state-closed` ("fora do fluxo de trabalho", igual a mês fechado), NUNCA
//   `--state-danger`: desistência não é erro, e vermelho aqui é reservado a bloqueio de fechamento.
// - `RASCUNHO` não é coluna do quadro — é bandeja separada, atrás de um toggle.

export const ONBOARDING_STATUS = Object.freeze({
  RASCUNHO: Object.freeze({
    chave: "RASCUNHO",
    rotulo: "Rascunho",
    token: "--text-faint",
    // ⚠ sem `surface`: rascunho não deve ganhar peso visual de cartão de trabalho.
    surface: null,
    icone: "✎",
    ordem: 0,
    noQuadro: false,
  }),
  RECEBIDO: Object.freeze({
    chave: "RECEBIDO",
    rotulo: "Recebido",
    token: "--state-warn",
    surface: "--state-warn-surface",
    icone: "◔",
    ordem: 1,
    noQuadro: true,
  }),
  EM_TRILHA: Object.freeze({
    chave: "EM_TRILHA",
    rotulo: "Em trilha",
    token: "--state-neutral",
    surface: "--state-neutral-surface",
    icone: "◐",
    ordem: 2,
    noQuadro: true,
  }),
  CONVERTIDO: Object.freeze({
    chave: "CONVERTIDO",
    rotulo: "Convertido",
    token: "--state-ok",
    surface: "--state-ok-surface",
    icone: "✓",
    ordem: 3,
    noQuadro: true,
  }),
  DESISTIU: Object.freeze({
    chave: "DESISTIU",
    rotulo: "Desistiu",
    token: "--state-closed",
    surface: "--state-closed-surface",
    icone: "⊘",
    ordem: 4,
    noQuadro: true,
  }),
});

const DESCONHECIDO = Object.freeze({
  chave: "DESCONHECIDO",
  rotulo: "—",
  token: "--text-faint",
  surface: null,
  icone: "?",
  ordem: 99,
  noQuadro: false,
});

/**
 * ⚠ Status desconhecido NÃO cai num status existente. Se o backend ganhar um valor novo, um
 * default para "EM_TRILHA" o esconderia dentro de uma coluna legítima; devolver um estado próprio
 * deixa a novidade visível na tela em vez de silenciosamente errada.
 */
export function statusDoOnboarding(status) {
  return ONBOARDING_STATUS[String(status || "").trim().toUpperCase()] || DESCONHECIDO;
}

/** As colunas do quadro, na ordem. Rascunho fica FORA — é bandeja, não coluna. */
export function colunasDoQuadro() {
  return Object.values(ONBOARDING_STATUS)
    .filter((s) => s.noQuadro)
    .sort((a, b) => a.ordem - b.ordem);
}

/** `estilo(status)` → objeto de estilo inline com as variáveis do tema (nunca hex literal). */
export function estiloDoStatus(status) {
  const s = statusDoOnboarding(status);
  return {
    color: `var(${s.token})`,
    borderColor: `var(${s.token})`,
    // ⚠ NADA de `${cor}22`: concatenar hex numa `var()` produz cor inválida que o browser descarta
    // em silêncio. Quando não há `-surface`, o fundo fica transparente — e é uma escolha, não uma
    // falta.
    background: s.surface ? `var(${s.surface})` : "transparent",
  };
}
