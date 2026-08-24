// A FORMA DO `AccountingEntry` QUE UM DECLARADO VIRA.
//
// ## ⚠⚠ ESTA FORMA FOI MEDIDA, NÃO DESENHADA
//
// Mudar a forma do lançamento contábil sem pedido explícito do dono é proibido nesta casa. Então
// ela não se escolhe: mede-se. `scripts/diag-forma-despesa.mjs` rodou contra produção em
// 24/08/2026 sobre os **155** lançamentos `tipo: "DESPESA"` que já existem:
//
//   | pernas               | 155/155 são `1D / 1C` — partida dobrada completa, nunca perna única |
//   | conta a crédito      | **`5` CAIXA - MATRIZ (1.1.1.01.0001) em 155 de 155.** Nunca fornecedor |
//   | eventType / subtipo  | nulos em 155/155                                                    |
//   | status               | `RASCUNHO` em 155/155                                               |
//   | statusPagamento      | `NA` em 155/155                                                     |
//   | histórico (EXCEL)    | o **nome do fornecedor** cru — "KODA BEAR", "GOOGLE CLOUD BRASIL…"   |
//
// ⚠ `eventType` NULO não é detalhe: existe um UNIQUE PARCIAL
// `("portalClientId","competencia","eventType","origem") WHERE tipo <> 'BAIXA'`. Com `eventType`
// nulo o Postgres trata cada linha como distinta e N notas do mesmo mês convivem. Preenchê-lo faria
// a SEGUNDA nota da competência estourar P2002 — em produção, não em teste.
//
// ⚠ ESTE MÓDULO É PURO. Ele não consulta banco e não cria nada: devolve o objeto que o serviço
// passa ao `create`, dentro da transação que também muda o estado do declarado.

/**
 * ⚠ VALOR NOVO de `origem`, e é deliberado. `MANUAL` e `EXCEL` já respondem "quem digitou isto?".
 * Um lançamento nascido da fila de conferência tem procedência própria — e é ela que permite
 * achá-los depois, inclusive para desfazer em lote se algo entrar errado.
 */
export const ORIGEM_DO_LANCAMENTO = "CONFERENCIA";

/**
 * ⚠⚠ A CONTRAPARTIDA, PELO `codigoCompleto` — NUNCA pelo reduzido.
 *
 * O reduzido é mutável e o completo é imutável ("eles são imutáveis enquanto os reduzidos
 * mutáveis"). Cravar `"5"` funcionaria hoje e poria a despesa numa conta qualquer no dia em que
 * alguém renumerasse o plano de uma empresa.
 *
 * Medido: 155 de 155 creditam a conta cujo `codigoCompleto` é este.
 */
export const CAIXA_CODIGO_COMPLETO = "111010001";

/** Recusas da montagem. ⚠ Vocabulário FECHADO — cada uma aponta um conserto diferente. */
export const RECUSA_DA_FORMA = Object.freeze({
  SEM_COMPETENCIA: "sem_competencia",
  SEM_DATA_DE_PAGAMENTO: "sem_data_de_pagamento",
  SEM_CONTA: "sem_conta",
  CONTA_FORA_DO_PLANO: "conta_fora_do_plano",
  CONTA_AMBIGUA: "conta_ambigua",
  CAIXA_FORA_DO_PLANO: "caixa_fora_do_plano",
  CAIXA_AMBIGUO: "caixa_ambiguo",
  VALOR_INVALIDO: "valor_invalido",
  SEM_HISTORICO: "sem_historico",
});

export const FRASE_DA_RECUSA_DA_FORMA = Object.freeze({
  [RECUSA_DA_FORMA.SEM_COMPETENCIA]:
    "Este lançamento não tem competência. Ela não é deduzida da data: seria o sistema decidindo em qual apuração a despesa entra.",
  [RECUSA_DA_FORMA.SEM_DATA_DE_PAGAMENTO]:
    "Sem a data em que o dinheiro saiu, o lançamento não pode creditar o caixa.",
  [RECUSA_DA_FORMA.SEM_CONTA]: "Escolha a conta contábil da despesa.",
  [RECUSA_DA_FORMA.CONTA_FORA_DO_PLANO]:
    "A conta escolhida não existe no plano desta empresa. Cadastre-a antes de lançar.",
  [RECUSA_DA_FORMA.CONTA_AMBIGUA]:
    "Duas contas do plano desta empresa têm o mesmo código completo. O sistema não escolhe entre elas.",
  [RECUSA_DA_FORMA.CAIXA_FORA_DO_PLANO]:
    "Esta empresa não tem a conta de caixa (1.1.1.01.0001) no plano. É ela que recebe o crédito de toda despesa.",
  [RECUSA_DA_FORMA.CAIXA_AMBIGUO]:
    "Duas contas do plano desta empresa apontam para a conta de caixa (1.1.1.01.0001).",
  [RECUSA_DA_FORMA.VALOR_INVALIDO]: "O valor do lançamento precisa ser um número maior que zero.",
  [RECUSA_DA_FORMA.SEM_HISTORICO]: "O lançamento precisa de histórico.",
});

/**
 * O índice `codigoCompleto → reduzido`, a partir do plano que `carregarPlano` devolve.
 *
 * ⚠ `AccountingEntryLine.conta` guarda o **reduzido**, em TEXTO e sem FK; o declarado guarda o
 * **completo**. Esta é a ponte, e ela existe num lugar só.
 *
 * ⚠ Conta sem `codigoCompleto` simplesmente não entra (há 13 assim na base) — e duas contas com o
 * MESMO completo marcam a entrada como **ambígua**: escolher uma poria a despesa num código que o
 * contador não escolheu, e ninguém veria.
 *
 * @param {Map<string, {codigo: string, codigoCompleto?: string|null}>} plano de `carregarPlano`
 */
export function indicePorCodigoCompleto(plano) {
  const indice = new Map();
  for (const conta of (plano || new Map()).values()) {
    const completo = String(conta?.codigoCompleto || "").trim();
    if (!completo) continue;
    const reduzido = String(conta?.codigo || "").trim();
    if (!reduzido) continue;
    const jaTem = indice.get(completo);
    if (jaTem && jaTem.reduzido !== reduzido) indice.set(completo, { reduzido: jaTem.reduzido, ambiguo: true });
    else if (!jaTem) indice.set(completo, { reduzido, ambiguo: false });
  }
  return indice;
}

const recusa = (motivo) => ({
  ok: false,
  motivo,
  frase: FRASE_DA_RECUSA_DA_FORMA[motivo] || "",
  entry: null,
});

/**
 * Monta o `AccountingEntry` (com as duas linhas) que este declarado vira.
 *
 * ⚠ NÃO confere se o declarado PODE ser contabilizado — isso é `estadosDeclarado.podeTransitar`, e
 * duas leituras da mesma pergunta divergiriam. Aqui se confere só o que a FORMA exige.
 *
 * @param {object} declarado a linha de `LancamentoDeclarado`, já com a transição aplicada
 * @param {Map} plano o retorno de `carregarPlano(portalClientId)`
 * @returns {{ok: boolean, motivo: string|null, frase: string, entry: object|null}}
 */
export function montarLancamento(declarado, plano) {
  const competencia = String(declarado?.competencia || "").trim();
  if (!competencia) return recusa(RECUSA_DA_FORMA.SEM_COMPETENCIA);

  const data = declarado?.dataPagamento;
  // ⚠⚠ A DATA DO LANÇAMENTO É A DO PAGAMENTO, nunca a do documento e nunca a do clique. O crédito
  // vai para o caixa: a data É a afirmação de quando o dinheiro saiu.
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) {
    return recusa(RECUSA_DA_FORMA.SEM_DATA_DE_PAGAMENTO);
  }

  const historico = String(declarado?.descricaoOriginal || "").trim();
  if (!historico) return recusa(RECUSA_DA_FORMA.SEM_HISTORICO);

  // ⚠ `valorAjustado` vence, quando existe — é o ato do contador dizendo que o documento não
  // reflete o que de fato saiu.
  const bruto = declarado?.valorAjustado ?? declarado?.valor;
  const valor = Number(bruto);
  if (!Number.isFinite(valor) || valor <= 0) return recusa(RECUSA_DA_FORMA.VALOR_INVALIDO);

  const completo = String(declarado?.contaAplicada || "").trim();
  if (!completo) return recusa(RECUSA_DA_FORMA.SEM_CONTA);

  const indice = indicePorCodigoCompleto(plano);

  const despesa = indice.get(completo);
  if (!despesa) return recusa(RECUSA_DA_FORMA.CONTA_FORA_DO_PLANO);
  if (despesa.ambiguo) return recusa(RECUSA_DA_FORMA.CONTA_AMBIGUA);

  const caixa = indice.get(CAIXA_CODIGO_COMPLETO);
  if (!caixa) return recusa(RECUSA_DA_FORMA.CAIXA_FORA_DO_PLANO);
  if (caixa.ambiguo) return recusa(RECUSA_DA_FORMA.CAIXA_AMBIGUO);

  return {
    ok: true,
    motivo: null,
    frase: "",
    entry: {
      portalClientId: declarado.portalClientId,
      data,
      competencia,
      historico,
      tipo: "DESPESA",
      // ⚠⚠ NULO, e não é esquecimento — ver o UNIQUE PARCIAL no cabeçalho deste arquivo.
      eventType: null,
      subtipo: null,
      origem: ORIGEM_DO_LANCAMENTO,
      status: "RASCUNHO",
      statusPagamento: "NA",
      lines: {
        create: [
          { conta: despesa.reduzido, tipo: "D", valor, ordem: 0 },
          { conta: caixa.reduzido, tipo: "C", valor, ordem: 1 },
        ],
      },
    },
  };
}
