/**
 * QUAL GUIA UMA BAIXA QUITA — e quando ela quita. Módulo PURO.
 *
 * ## ⚠⚠ Por que existe (relato do dono, 30/08/2026)
 *
 * > *"apareceram impostos que estão pagos na circular e lançados em lançamentos como aberto."*
 *
 * ⚠⚠ **O ELO EXISTIA NUM SENTIDO SÓ.** `GuideToProvisionService` promove a PROVISÃO quando a guia é
 * paga; o caminho de volta — a **baixa lançada** devolvendo o estado à guia — não existia. O
 * resultado, medido em produção antes do conserto (`scripts/diag-circular-celula-aberta.mjs` e o
 * inverso dele): **20 provisões de DAS com `statusPagamento: "PAGO"`, com a baixa lançada e o
 * dinheiro fora do caixa, cuja guia continuava `paymentStatus: "OPEN"`.** Duas delas já liberadas ao
 * cliente — LENTE 06/2026 (R$ 15.033,58, baixa em 14/07) e CHAYM 06/2026 (R$ 1.058,40, baixa em
 * 05/07) —, ou seja, cobrança em aberto na tela de quem já tinha pago.
 *
 * ## ⚠⚠ A CHAVE, e por que ela não é um palpite
 *
 * A provisão do DAS nasce do **extrato do PGDAS-D** (`amountSource: "das_total"`), não da guia —
 * então ela **não tem `sourceGuideId`**. Quem liga as duas é a competência, e isso **não é
 * invenção deste módulo**: é a MESMA chave que a Circular já usa para decidir se desenha a provisão
 * real ou sintetiza a linha a partir da guia (`mesesComDas`, em `routes/firm/accountingEntries.js`).
 * Aqui ela só passou a valer nos dois sentidos.
 *
 * ⚠ Quando `sourceGuideId` existe, ele VENCE: é vínculo explícito, e a competência é a reserva.
 *
 * ## ⚠⚠ O que este módulo se recusa a fazer
 *
 * - **Não quita em baixa PARCIAL.** Meio pago não é pago; a guia continua aberta, com o saldo à
 *   vista na Circular. Só `PAGO` fecha.
 * - **Não rebaixa nada.** Guia já paga com PROVA (SERPRO) ou com a afirmação do CONTADOR (MANUAL)
 *   é deixada em paz.
 * - ⚠⚠ **MAS CORRIGE A DO CLIENTE**, e isto foi acrescentado em 30/08/2026, com um caso na mão. A
 *   hierarquia é a que `procedenciaDoPagamento.js` já escreve: *SERPRO é prova; MANUAL é o contador,
 *   que responde pela contabilidade; CLIENTE é afirmação de quem paga, e **não é prova***. Um
 *   lançamento de baixa é ato do contador, com data que foi para o razão — ele vence o clique.
 *   ⚠ Isto NÃO é rebaixar: é promover de afirmação para fato contábil.
 *
 *   **O caso que obrigou a regra** (ERISANGELA, relatado pelo dono como *"um pagamento de 1.876,46
 *   que não faz sentido"*): o cliente confirmou DUAS guias em 30/08 e as duas ficaram com a data do
 *   clique, caindo no mesmo dia do fluxo e somando R$ 1.876,46 — um pagamento que nunca houve. Uma
 *   delas, o DAS de 05/2026 de R$ 1.552,63, está provada no razão em **13/06/2026**: três
 *   lançamentos contra o caixa (principal 1.438,55 + juros 99,69 + multa 14,39) que somam
 *   exatamente o valor da guia.
 * - **Não inventa data.** A data do pagamento é a **da baixa**, que é o dia em que o contador
 *   afirma que o dinheiro saiu — o mesmo dia que foi para o razão. É a regra fixada em 30/08/2026:
 *   `paymentConfirmedAt` é quando o dinheiro saiu, nunca o instante do clique.
 * - **Não atravessa parcelamento.** Parcela vive na aba Parcelamento e tem baixa própria.
 */

/** Por que a baixa não quita guia nenhuma. Vocabulário FECHADO. */
export const SEM_QUITACAO = Object.freeze({
  BAIXA_PARCIAL: "BAIXA_PARCIAL",
  SEM_COMPETENCIA: "SEM_COMPETENCIA",
  TIPO_SEM_GUIA: "TIPO_SEM_GUIA",
});

/**
 * ⚠ Só as provisões que TÊM uma guia correspondente por competência. `DAS_SIMPLES`/subtipo `DAS` é
 * o caso medido; os DARFs do Lucro Presumido já nascem com `sourceGuideId` e entram pelo vínculo
 * explícito, sem precisar da chave por competência.
 */
const SUBTIPO_TO_TIPO_DE_GUIA = Object.freeze({ DAS: "SIMPLES" });
const EVENT_TO_TIPO_DE_GUIA = Object.freeze({ DAS_SIMPLES: "SIMPLES" });

/**
 * ⚠⚠ ESTA GUIA AINDA PODE RECEBER A DATA DA BAIXA?
 *
 * Três respostas, e elas seguem a hierarquia de `procedenciaDoPagamento.js`:
 *   · **não paga** ......... sim, a baixa a quita;
 *   · **paga por CLIENTE** . sim — o clique não é prova, e o lançamento do contador é. Corrige a
 *                            data e promove a procedência;
 *   · **paga por SERPRO ou MANUAL** ... não. A primeira é prova; a segunda é o contador, que já
 *                            respondeu. Sobrescrever qualquer uma seria apagar evidência melhor.
 *
 * ⚠ Procedência AUSENTE conta como já respondida: há guias pagas anteriores à coluna, e tratá-las
 * como "cliente" mexeria em contabilidade fechada por causa de um campo que ninguém preencheu — é
 * o mesmo default seguro que `pagamentoAlcancaOContabil` já adota.
 */
export function baixaPodeDatarAGuia(guia) {
  if (String(guia?.paymentStatus || "").toUpperCase() !== "PAID") return true;
  return String(guia?.paymentStatusSource || "").toUpperCase() === "CLIENTE";
}

/**
 * O que procurar para quitar, a partir da provisão baixada.
 *
 * @param {object} p
 * @param {object} p.provisao  a provisão baixada (`{ id, portalClientId, competencia, eventType,
 *                             subtipo, sourceGuideId }`)
 * @param {string} p.novoStatus  o status em que a provisão FICOU: "PAGO" | "PARCIAL"
 * @returns {{alvo: object|null, motivo: string|null}}  `alvo` é `{guideId}` ou o critério
 *          `{portalClientId, competencia, tipo}` — quem consulta o banco é o chamador.
 */
export function guiaQuitadaPelaBaixa({ provisao, novoStatus }) {
  // ⚠ Meio pago não é pago. A Circular já mostra o saldo; a guia continua sendo cobrança.
  if (String(novoStatus).toUpperCase() !== "PAGO") {
    return { alvo: null, motivo: SEM_QUITACAO.BAIXA_PARCIAL };
  }

  // ⚠ Vínculo explícito vence a chave por competência, sempre.
  if (provisao?.sourceGuideId) {
    return { alvo: { guideId: String(provisao.sourceGuideId) }, motivo: null };
  }

  const tipo = EVENT_TO_TIPO_DE_GUIA[provisao?.eventType]
    || SUBTIPO_TO_TIPO_DE_GUIA[provisao?.subtipo]
    || null;
  if (!tipo) return { alvo: null, motivo: SEM_QUITACAO.TIPO_SEM_GUIA };

  // ⚠ Sem competência não há chave — e adivinhar por data marcaria a guia de outro mês como paga.
  const competencia = String(provisao?.competencia || "").trim();
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    return { alvo: null, motivo: SEM_QUITACAO.SEM_COMPETENCIA };
  }

  return {
    alvo: {
      portalClientId: String(provisao.portalClientId),
      competencia,
      tipo,
      // ⚠⚠ PARCELA DE PARCELAMENTO NUNCA ENTRA: ela é gravada como `tipo: "SIMPLES"`, idêntica ao
      // DAS, e só `parcelamentoId` as separa. Sem esta linha, a baixa do DAS de um mês quitaria a
      // parcela daquele mês — dívida antiga, de outro acordo.
      parcelamentoId: null,
    },
    motivo: null,
  };
}
