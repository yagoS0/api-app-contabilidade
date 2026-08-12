// O DETECTOR: o razão discorda da CIRCULAR?
//
// ⚠ REGRA DE ARQUITETURA DO DONO: *"a DAS, como todos os outros impostos, deve ter uma ÚNICA
// FONTE, um único dado de tabela que deve ser usado, e alterado caso seja alterado por uma
// retificação"*. A fonte do imposto declarado é a CIRCULAR (o extrato/declaração da Receita); o
// lançamento DERIVA dela (`generateEntriesFromCircular`); a guia é o DOCUMENTO. Os três existem
// legitimamente separados — o que não pode é DIVERGIREM SEM QUE NINGUÉM SAIBA.
//
// Isto mede exatamente essa divergência, e só ela.
//
// ── POR QUE ISTO É DERIVADO, E NÃO UMA COLUNA ────────────────────────────────────────────────
// `CompanyMonthlyCircular.hasAccountingDivergence` já existe e é gravado por
// `generateEntriesFromCircular` — e é uma GUARDA MORTA: varredura de 12/08/2026 nos dois apps não
// achou UM leitor (nenhum `select`, nenhum `where`, nenhum componente, nenhum teste). Vale para o
// projeto inteiro: a conferência do ADN nunca gravou nada, o `alcancouFim` nunca foi consultado.
// Somar mais um bit àquela coluna seria alimentar a mesma guarda que ninguém lê.
//
// Pior: uma coluna só é reescrita quando a SINCRONIA roda. As 12 divergências vivas hoje foram
// gravadas por sincronias que já aconteceram — nenhuma delas voltaria a rodar sozinha, e a coluna
// continuaria dizendo `false`. Derivar na leitura é a mesma disciplina de
// `LedgerProjectionService.computeSituacao` ("status é projeção recalculável, nunca coluna
// gravada") e é o que faz o detector enxergar o passado, não só o futuro.
//
// ── POR QUE ELE NÃO TEM LISTA PRÓPRIA DE TRIBUTOS ────────────────────────────────────────────
// ⚠ Ele importa `EVENT_DEFINITIONS` e `resolveAmount` do PRÓPRIO GERADOR. Uma segunda lista de
// eventos, ou uma segunda leitura de "quanto a circular diz", divergiria no primeiro tributo novo
// — e o detector passaria a medir MENOS do que o gerador escreve, em silêncio. É exatamente a
// classe de defeito que ele existe para pegar.
//
// ⚠ `resolveAmount` (e não `circular.dasTotal` cru) porque a provisão usa o PRINCIPAL quando há
// split `acrescimos.DAS.principal` gravado: juros e multa de guia vencida não são imposto do mês.
// Comparar contra o `dasTotal` cru acusaria como divergência o caso legítimo do documento com
// acréscimo — o falso positivo que faria o aviso ser ignorado.

import { EVENT_DEFINITIONS, AMOUNT_SOURCE_FIELD_MAP, resolveAmount, valorDoLancamento } from "./AccountingEntryGeneratorService.js";

/** Rótulo humano por evento — é o que o contador lê na tela, não o `eventType`. */
const ROTULO_DO_EVENTO = Object.freeze({
  DAS_SIMPLES: "DAS (Simples Nacional)",
  RECEITA_SERVICO: "Receita de serviços",
  RECEITA_VENDA_SEM_ST: "Receita de vendas s/ ST",
  RECEITA_VENDA_COM_ST: "Receita de vendas c/ ST",
});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Onde o lançamento gerado a partir da circular deixou de acompanhá-la.
 *
 * PURA: recebe a circular e os lançamentos já carregados. Quem consulta o banco é a rota — mesma
 * disciplina de `computeFechamentoBlockers`, para que a aba Lançamentos e a visão de carteira
 * possam responder a MESMA coisa sem uma segunda cópia da regra.
 *
 * @param {object|null} circular linha de `company_monthly_circulars` com os campos de valor
 * @param {Array} entries lançamentos da competência, com `lines` e `eventType`
 * @returns {Array<{eventType,rotulo,campo,esperado,lancado,diferenca,entryId,historico}>}
 */
export function divergenciasDeFonte(circular, entries) {
  if (!circular) return [];
  const porEvento = new Map();
  for (const e of entries || []) {
    // ⚠ Só o lançamento GERADO pela circular entra. `origem: "SERPRO"` é a mesma chave que
    // `generateEntriesFromCircular` usa para achar o existente — um lançamento MANUAL com o mesmo
    // evento é outro fato, e cobrá-lo daqui acusaria trabalho legítimo do contador.
    if (String(e?.origem || "") !== "SERPRO") continue;
    if (e?.eventType && !porEvento.has(e.eventType)) porEvento.set(e.eventType, e);
  }

  const out = [];
  for (const [eventType, definition] of Object.entries(EVENT_DEFINITIONS)) {
    const esperado = resolveAmount(circular, definition.amountSource);
    // ⚠ AUSÊNCIA NUNCA É RESPOSTA. Circular sem o número não afirma nada sobre o lançamento —
    // acusar divergência aí transformaria "ninguém buscou o extrato" em "o razão está errado".
    if (esperado == null) continue;

    const entry = porEvento.get(eventType);
    // Sem lançamento não há o que divergir: isso é "falta gerar", que é outra pergunta (e o
    // gerador já a responde com `skipped`/`missing_rule`). Misturar as duas faria a competência
    // recém-buscada nascer acusada.
    if (!entry) continue;

    const lancado = round2(valorDoLancamento(entry.lines || []));
    const alvo = round2(esperado);
    if (Math.abs(alvo - lancado) <= 0.01) continue;

    out.push({
      eventType,
      rotulo: ROTULO_DO_EVENTO[eventType] || eventType,
      campo: AMOUNT_SOURCE_FIELD_MAP[definition.amountSource] || definition.amountSource,
      esperado: alvo,
      lancado,
      diferenca: round2(alvo - lancado),
      entryId: entry.id || null,
      historico: entry.historico || null,
    });
  }
  return out;
}

/** Campos da circular que o detector precisa — para o `select` da rota não arrastar a linha toda. */
export const SELECT_CIRCULAR_PARA_DIVERGENCIA = Object.freeze({
  receitaBruta: true,
  receitaServicos: true,
  receitaVendasSemST: true,
  receitaVendasComST: true,
  dasTotal: true,
  inssTotal: true,
  acrescimos: true,
});

/** Eventos que o detector sabe conferir — os que o gerador de fato deriva da circular. */
export const EVENTOS_DERIVADOS_DA_CIRCULAR = Object.freeze(Object.keys(EVENT_DEFINITIONS));
