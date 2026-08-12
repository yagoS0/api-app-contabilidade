// QUEM ENTREGA A DEFIS — e, principalmente, quem NÃO entrega.
//
// ⚠ FONTE (regra 4 — fonte oficial vence). Tudo abaixo foi lido no documento oficial, não de
// memória: Manual do PGDAS-D e DEFIS, Receita Federal (o mesmo que já sustenta `defisSpec.js`),
// seção 9, p. 82:
//
//   "A Declaração de Informações Socioeconômicas e Fiscais - DEFIS deve ser prestada por
//    contribuinte optante do Simples Nacional por pelo menos um período nela abrangido, ou para o
//    qual exista processo administrativo formalizado em alguma unidade das administrações
//    tributárias (…) que possa resultar em sua inclusão no Simples Nacional em período abrangido
//    pela DEFIS. (Lei Complementar nº 123, de 2006, art. 25, caput)."
//
// O prazo e a situação especial saem do mesmo manual, item 9.1.2, citando a **Resolução CGSN nº
// 140/2018, art. 72, §§ 1º e 2º** — ou seja, o art. 72 É o dispositivo da DEFIS. Confirmado; não
// copiado de terceiros.
//
// ⚠ POR QUE ISTO EXISTE COMO REGRA, E NÃO COMO UM `if` NA TELA
// A tela não perguntava o regime: o botão "📄 Espelho da DEFIS" era oferecido a TODA empresa, e o
// defeito relatado pelo dono ("empresas do presumido estão com espelho da DEFIS, mas empresas
// presumidas não têm DEFIS") era ausência de regra, não regra errada. É a mesma classe de problema
// que `entregas/lib/obrigatoriedadeEfd.js` resolve, com o SINAL INVERTIDO: a EFD-Contribuições
// dispensa o Simples; a DEFIS dispensa quem NÃO é do Simples.
//
// ⚠ E A DISPENSA NÃO É SUMIR. O botão não desaparece calado: a tela diz que a empresa está
// dispensada, com o motivo e a fonte, no lugar do fluxo. Some da tela quem não deve nada, e aí
// ninguém sabe se foi dispensa ou esquecimento.
//
// ⚠ NADA AQUI TRANSMITE, e esta regra não muda isso. A DEFIS é transmitida NO PORTAL do Simples
// Nacional; o nosso lado só guarda a folha de transcrição e registra o recibo.

/**
 * A resposta é sobre o ANO-CALENDÁRIO, não sobre "hoje" — e essa distinção é o coração da regra.
 * O manual (item 9.2.2) é explícito: "em relação ao ano-calendário de exclusão da PJ do Simples
 * Nacional, a DEFIS abrangerá o período em que esteve na condição de optante". Empresa que saiu do
 * Simples em 2026 AINDA DEVE a DEFIS de 2025.
 *
 * O sistema guarda só o regime de HOJE (`Company.regimeTributario`), não o histórico. Por isso a
 * hipótese que derrubaria a dispensa viaja NOMEADA junto dela, em vez de ser aplicada ou ignorada.
 */
const OBRIGATORIEDADES_NAO_AVALIADAS = Object.freeze([
  {
    chave: "optanteNoAno",
    titulo: "A empresa foi optante pelo Simples Nacional em algum período deste ano-calendário",
    detalhe:
      "Basta ter sido optante por UM período abrangido para a DEFIS do ano ser devida. No ano-calendário da exclusão, a declaração abrange o período em que a empresa esteve na condição de optante. O sistema guarda apenas o regime atual, não o histórico.",
  },
  {
    chave: "processoAdministrativo",
    titulo: "Há processo administrativo que possa resultar em inclusão no Simples Nacional",
    detalhe:
      "Processo formalizado em unidade da administração tributária federal, estadual, distrital ou municipal que possa incluir a empresa no Simples Nacional no período abrangido. O portal não conhece esses processos.",
  },
]);

const FONTE =
  "Manual do PGDAS-D e DEFIS (RFB), seção 9 · LC 123/2006, art. 25, caput · Res. CGSN 140/2018, art. 72";

/**
 * Regimes que dispensam a DEFIS, com o motivo de cada um.
 *
 * ⚠ O Simei tem motivo PRÓPRIO, não é "mais um não-Simples". O manual o trata ao lado do
 * não-optante (itens 4 e 9.2.2): ao optante pelo Simei "somente será permitido declarar caso tenha
 * formalizado processo administrativo (…) que possa resultar em inclusão administrativa no Simples
 * Nacional". Qual é a declaração anual DELE não está neste documento — e o que não se confirma não
 * se escreve, então a frase não nomeia substituta.
 */
const DISPENSADOS_POR_REGIME = Object.freeze({
  LUCRO_PRESUMIDO: "optante pelo Lucro Presumido",
  LUCRO_REAL: "optante pelo Lucro Real",
  LUCRO_ARBITRADO: "tributada pelo Lucro Arbitrado",
  MEI: "optante pelo Simei (microempreendedor individual)",
  SIMEI: "optante pelo Simei (microempreendedor individual)",
});

/** Os regimes que DEVEM a DEFIS. As duas grafias chegam do backend. */
const OBRIGADOS_POR_REGIME = Object.freeze({
  SIMPLES: true,
  SIMPLES_NACIONAL: true,
});

function normalizarRegime(regime) {
  return String(regime || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/** O ano só entra no texto se for um ano-calendário plausível — nunca "a DEFIS de undefined". */
function anoLegivel(anoCalendario) {
  const n = Number(anoCalendario);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? String(n) : null;
}

/**
 * Responde se a empresa deve a DEFIS daquele ANO-CALENDÁRIO.
 *
 * Três respostas, e a terceira é tão importante quanto as outras duas:
 *  - `obrigada`    — deve entregar; a tela abre o espelho.
 *  - `dispensada`  — não deve, e o motivo aparece com a fonte no lugar do fluxo.
 *  - `indefinida`  — o regime não está cadastrado. NÃO afirma nem uma coisa nem outra: um default
 *                    para "obrigada" ofereceria ~40 campos de trabalho que a lei não pede, e um
 *                    para "dispensada" esconderia obrigação real de uma empresa do Simples.
 *                    Ausência de dado é o terceiro estado, não um empate a desempatar.
 *
 * @param {{regime?: string, anoCalendario?: number|string}} entrada
 */
export function obrigatoriedadeDefis({ regime, anoCalendario } = {}) {
  const r = normalizarRegime(regime);
  const ano = anoLegivel(anoCalendario);
  const doAno = ano ? ` de ${ano}` : "";

  if (!r) {
    return {
      situacao: "indefinida",
      motivo: "O regime tributário da empresa não está cadastrado.",
      acao: `Cadastre o regime na ficha da empresa para saber se a DEFIS${doAno} é devida.`,
      fonte: FONTE,
      obrigatoriedadesNaoAvaliadas: [],
    };
  }

  if (OBRIGADOS_POR_REGIME[r]) {
    return {
      situacao: "obrigada",
      motivo: null,
      acao: null,
      fonte: FONTE,
      // Empresa que já deve não recebe a lista: não há dispensa a derrubar.
      obrigatoriedadesNaoAvaliadas: [],
    };
  }

  const dispensaRegime = DISPENSADOS_POR_REGIME[r];
  if (dispensaRegime) {
    return {
      situacao: "dispensada",
      motivo: `Empresa ${dispensaRegime} — a DEFIS é declaração do Simples Nacional e não é devida por quem não é optante.`,
      // ⚠ A saída do Simples é o caso que faz esta resposta ser por ANO, e ele acontece de verdade:
      // a empresa excluída continua devendo a DEFIS do ano em que foi optante.
      acao: `Se a empresa foi optante pelo Simples Nacional em algum período${doAno}, a DEFIS desse ano-calendário continua devida — o portal decide pelo regime cadastrado hoje, e não guarda o histórico.`,
      fonte: FONTE,
      obrigatoriedadesNaoAvaliadas: OBRIGATORIEDADES_NAO_AVALIADAS,
    };
  }

  return {
    situacao: "indefinida",
    motivo: `O regime "${regime}" não está entre os que o sistema sabe classificar para a DEFIS.`,
    acao: "Confira se a empresa é optante pelo Simples Nacional antes de entregar ou deixar de entregar a DEFIS.",
    fonte: FONTE,
    obrigatoriedadesNaoAvaliadas: [],
  };
}

export const DEFIS_OBRIGATORIEDADE_FONTE = FONTE;
export const DEFIS_OBRIGATORIEDADES_NAO_AVALIADAS = OBRIGATORIEDADES_NAO_AVALIADAS;
