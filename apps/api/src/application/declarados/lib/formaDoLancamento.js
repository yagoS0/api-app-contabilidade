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

// ⚠⚠ A TRAVA DE CONTA SINTÉTICA É IMPORTADA, NUNCA REESCRITA. `ehContaSintetica` e `mensagemRecusa`
// vivem em `accounting/lib/gateContaSintetica.js`, que é PURO (sem prisma, sem I/O) e é a mesma
// autoridade que `POST/PUT /entries` usa. Um segundo predicado aqui divergiria na primeira
// correção, e a divergência apareceria como "a Conferência aceitou o que os Lançamentos recusam".
// ⚠ O motivo da trava é EXTERNO e está escrito lá: o registro **I250** da ECD exige `IND_CTA = "A"`
// (analítica). Lançar em conta de agregação não falha aqui — falha na ENTREGA, meses depois, longe
// do lançamento que a causou.
import { ehContaSintetica, mensagemRecusa } from "../../accounting/lib/gateContaSintetica.js";
// ⚠⚠ A REGRA DA DISPONIBILIDADE É IMPORTADA, NUNCA REESCRITA — e é a MESMA que decide o que entra
// no fluxo de caixa e a que `RegraService` já usa para recusar o crédito de uma regra. Ela responde
// pelo PREFIXO do `codigoCompleto`, nunca pelo nome. ⚠ NÃO reescrever como `!== NAO_DISPONIVEL`:
// com isso `DISPONIVEL_NAO_CLASSIFICADO` e `INDETERMINADO` entrariam.
import { entraNoFluxoDeCaixa } from "../../accounting/lib/disponibilidades.js";

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
  CONTA_SINTETICA: "conta_sintetica",
  CAIXA_FORA_DO_PLANO: "caixa_fora_do_plano",
  CAIXA_AMBIGUO: "caixa_ambiguo",
  CAIXA_SINTETICO: "caixa_sintetico",
  CREDITO_FORA_DO_PLANO: "credito_fora_do_plano",
  CREDITO_AMBIGUO: "credito_ambiguo",
  CREDITO_SINTETICO: "credito_sintetico",
  CREDITO_NAO_E_DISPONIBILIDADE: "credito_nao_e_disponibilidade",
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
  // ⚠ Esta é FALLBACK. Na recusa de verdade quem escreve é `gateContaSintetica.mensagemRecusa`,
  // que NOMEIA a conta e oferece as filhas analíticas — recusa muda é o defeito, não a recusa.
  [RECUSA_DA_FORMA.CONTA_SINTETICA]:
    "A conta escolhida é SINTÉTICA (de agregação) e não recebe lançamento. Escolha uma conta analítica abaixo dela.",
  [RECUSA_DA_FORMA.CAIXA_FORA_DO_PLANO]:
    "Esta empresa não tem a conta de caixa (1.1.1.01.0001) no plano. É ela que recebe o crédito de toda despesa.",
  [RECUSA_DA_FORMA.CAIXA_AMBIGUO]:
    "Duas contas do plano desta empresa apontam para a conta de caixa (1.1.1.01.0001).",
  [RECUSA_DA_FORMA.CAIXA_SINTETICO]:
    "A conta de caixa (1.1.1.01.0001) desta empresa está marcada como SINTÉTICA (de agregação) e não "
    + "recebe lançamento. Corrija o plano de contas: é ela que recebe o crédito de toda despesa.",
  // ⚠ As três abaixo são as irmãs das `CAIXA_*`, e existem separadas porque o CONSERTO é outro: lá
  // o caixa é cravado e o plano é que está torto ("corrija o plano"); aqui a conta foi ESCOLHIDA
  // por uma pessoa, e o conserto é escolher outra.
  [RECUSA_DA_FORMA.CREDITO_FORA_DO_PLANO]:
    "A conta de crédito escolhida não existe no plano desta empresa. Escolha outra, ou cadastre-a antes de lançar.",
  [RECUSA_DA_FORMA.CREDITO_AMBIGUO]:
    "Duas contas do plano desta empresa têm o código completo da conta de crédito escolhida. O sistema não escolhe entre elas.",
  [RECUSA_DA_FORMA.CREDITO_SINTETICO]:
    "A conta de crédito escolhida é SINTÉTICA (de agregação) e não recebe lançamento. Escolha uma conta analítica abaixo dela.",
  // ⚠⚠ Resposta do dono, 29/08/2026: *"continua sendo disponibilidade (caixa/banco)"*. O que muda
  // numa compra de ativo é o DÉBITO, que sempre foi livre.
  [RECUSA_DA_FORMA.CREDITO_NAO_E_DISPONIBILIDADE]:
    "O crédito de uma despesa sai de caixa ou banco. A conta escolhida não é de disponibilidade — "
    + "se o que muda é a natureza do gasto (uma compra de ativo, por exemplo), quem muda é a conta de DÉBITO.",
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
    // ⚠ `conta` viaja junto porque a trava de sintética precisa de `analitica` (para decidir) e de
    // `nome` (para a recusa NOMEAR a conta). Acrescentar campo é aditivo: quem lê `reduzido`/
    // `ambiguo` não muda. ⚠⚠ No ramo AMBÍGUO a `conta` fica a da PRIMEIRA, como o `reduzido` já
    // ficava — e não importa qual, porque ambíguo já recusa antes de a sintética ser consultada.
    if (jaTem && jaTem.reduzido !== reduzido) {
      indice.set(completo, { reduzido: jaTem.reduzido, conta: jaTem.conta, ambiguo: true });
    } else if (!jaTem) {
      indice.set(completo, { reduzido, conta, ambiguo: false });
    }
  }
  return indice;
}

/**
 * ⚠ `fraseCustom` existe para UMA recusa: a de conta sintética, cuja frase NOMEIA a conta e oferece
 * a saída (as filhas analíticas). O mapa estático não consegue fazer isso — ele não conhece a
 * conta. As demais recusas continuam saindo do mapa, e o mapa continua sendo o fallback desta.
 */
const recusa = (motivo, fraseCustom = null) => ({
  ok: false,
  motivo,
  frase: fraseCustom || FRASE_DA_RECUSA_DA_FORMA[motivo] || "",
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
  // ⚠⚠ A TRAVA VEM DEPOIS de fora-do-plano e de ambígua, e a ordem é a resposta certa: sem saber
  // QUAL é a conta, não há o que afirmar sobre ela. Recusar "sintética" uma conta que nem existe no
  // plano mandaria o contador procurar filha analítica de uma conta inexistente.
  // ⚠ `analitica` é TRI-ESTADO: `ehContaSintetica` compara `=== false`. `null` (conta sem
  // `codigoCompleto`, ainda não reimportada) NÃO é sintética — recusar no desconhecido travaria
  // todo plano que não passou pelo import, e ausência nunca é resposta.
  if (ehContaSintetica(despesa.conta)) {
    return recusa(
      RECUSA_DA_FORMA.CONTA_SINTETICA,
      // ⚠ A recusa nomeia o REDUZIDO, que é o que o contador digitou e lê — não o `codigoCompleto`,
      // que é âncora interna e ele nunca vê.
      mensagemRecusa([{ codigo: despesa.reduzido, nome: despesa.conta?.nome || "" }]),
    );
  }

  /**
   * ⚠⚠ O CRÉDITO ESCOLHIDO VENCE O CAIXA CRAVADO (01/09/2026) — decisão do dono: *"aqueles que
   * viram lançamento contábil devem ter opção de colocar débito e crédito"*.
   *
   * ⚠ `null`/vazio = ninguém escolheu, e aí é o caixa de sempre (`111010001`), que é o
   * comportamento medido das 155 despesas existentes. A ausência NÃO é recusada.
   * ⚠⚠ As recusas são SEPARADAS das do caixa de propósito: quando a conta foi escolhida por uma
   * pessoa, o conserto é escolher outra; quando é o caixa cravado, o conserto é corrigir o PLANO.
   * Uma frase só mandaria metade dos casos para o lugar errado.
   */
  const creditoEscolhido = String(declarado?.contaCredito || "").trim();
  const completoDoCredito = creditoEscolhido || CAIXA_CODIGO_COMPLETO;
  const escolhido = Boolean(creditoEscolhido) && creditoEscolhido !== CAIXA_CODIGO_COMPLETO;

  const caixa = indice.get(completoDoCredito);
  if (!caixa) return recusa(escolhido ? RECUSA_DA_FORMA.CREDITO_FORA_DO_PLANO : RECUSA_DA_FORMA.CAIXA_FORA_DO_PLANO);
  if (caixa.ambiguo) return recusa(escolhido ? RECUSA_DA_FORMA.CREDITO_AMBIGUO : RECUSA_DA_FORMA.CAIXA_AMBIGUO);
  /**
   * ⚠⚠ O CRÉDITO TEM DE SER DISPONIBILIDADE — resposta do dono, 29/08/2026: *"continua sendo
   * caixa/banco"*, e ele não foi revogado pelo pedido de 01/09 (lá o exemplo é *compra de ativo*,
   * que muda o **débito**).
   *
   * ⚠⚠ SEM ESTA GUARDA, uma despesa creditando `fornecedores a pagar` sairia daqui — e ela AFIRMA
   * que o dinheiro saiu do caixa, que é a invariante que sustenta o fluxo inteiro. O lançamento
   * seria válido no razão e mentiria no caixa: some do fluxo (que só conta o que credita
   * disponibilidade) sem nunca aparecer como obrigação em lugar nenhum.
   * ⚠ Só vale para a conta ESCOLHIDA: o caixa cravado já é disponibilidade por construção, e
   * medi-lo aqui recusaria a empresa cujo plano ainda não tem `codigoCompleto` na conta de caixa —
   * que é problema de plano, e já tem recusa própria.
   */
  if (escolhido && !entraNoFluxoDeCaixa(caixa.conta)) {
    return recusa(RECUSA_DA_FORMA.CREDITO_NAO_E_DISPONIBILIDADE);
  }
  // ⚠ O caixa é CRAVADO (`111010001`), então esta recusa é sobre o PLANO estar torto, não sobre uma
  // escolha do contador — por isso ela tem motivo próprio, e a frase manda corrigir o plano em vez
  // de mandar escolher outra conta. Sem ela, a perna de crédito entraria em conta de agregação pelo
  // mesmo buraco que a de débito, e `POST /entries` recusaria as duas.
  if (ehContaSintetica(caixa.conta)) {
    return recusa(escolhido ? RECUSA_DA_FORMA.CREDITO_SINTETICO : RECUSA_DA_FORMA.CAIXA_SINTETICO);
  }

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
