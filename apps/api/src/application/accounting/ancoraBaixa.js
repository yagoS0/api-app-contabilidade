// A ÂNCORA DA BAIXA — a fonte ÚNICA de "sobre o que esta baixa foi dada".
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// POR QUE ESTE ARQUIVO EXISTE
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// A baixa nasceu ancorada na GUIA: `gerarPagamentoParcelaFromGuide` exige `guideId` na assinatura,
// na guarda de idempotência (`sourceGuideId`) e no efeito (`guide.baixada`/`lancamentoId`). O
// estorno foi escrito contra essa mesma âncora — ele REABRE A GUIA — e por muito tempo isso bastou,
// porque só existia uma via de baixa.
//
// A F2.2 abriu a segunda: `gerarPagamentoParcelaManual` baixa uma prestação **sem guia** (débito
// automático), ancorada na PARCELA, gravando `parcelas.origemBaixa = "MANUAL"`. O estorno não a
// alcançava: sem guia não há guia a reabrir, `origemBaixa` não era limpo, e a parcela ficava
// baixada PARA SEMPRE — o defeito exato que a F2.4 corrigiu do lado da guia (parcela presa em
// `ja_baixada`, fora da fila, sem caminho de volta por nenhuma tela).
//
// ⚠ A CORREÇÃO NÃO É UM SERVIÇO IRMÃO. Um `EstornoBaixaParcelaService` ao lado reproduziria a
// estrutura que gerou o bug: dois serviços que divergem na próxima invariante (o projeto já tem o
// precedente — as DUAS memórias de conta do parcelamento e as QUATRO cópias do filtro de envio).
// A regra estrutural é: **baixa e estorno operam sobre a MESMA âncora, sempre**. Este módulo é onde
// essa âncora é declarada, uma vez, para os dois lados lerem.
//
// ⚠ E É POR ISSO QUE A LISTA MORA AQUI, E NÃO DENTRO DO TESTE. Escrita à mão no teste, alguém
// acrescenta a origem nova no serviço, esquece do teste, e o contrato não morde. Vinda daqui, a
// próxima via de baixa (a do SERPRO, `DETPAGTOPARC165`, que gravará `DEBITO_AUTOMATICO`) já nasce
// dentro do contrato: ou a âncora dela tem reversor, ou o teste fica VERMELHO até ter.

/**
 * As âncoras possíveis de uma baixa. Cada uma tem de ter um reversor no estorno —
 * `EstornoBaixaService.REVERSORES` é indexado por estes valores, e o teste de contrato exige a
 * cobertura completa.
 */
export const ANCORAS = Object.freeze({
  /** A baixa amortiza uma GUIA (documento). Desfazer = reabrir a guia. */
  GUIA: "GUIA",
  /** A baixa amortiza uma PRESTAÇÃO sem documento. Desfazer = limpar `origemBaixa`/`baixadaEm`. */
  PARCELA: "PARCELA",
  /**
   * Nem guia nem prestação: a baixa genérica de uma provisão qualquer
   * (`POST /entries/:id/baixa`). O que há a desfazer são os LANÇAMENTOS, e nada mais — é o
   * comportamento que o estorno já tinha para esses casos, nomeado em vez de implícito.
   */
  LANCAMENTO: "LANCAMENTO",
});

/**
 * O VOCABULÁRIO de `parcelas.origemBaixa`, com a âncora de cada via.
 *
 * ⚠ É a mesma lista que o comentário da coluna no `schema.prisma` declara
 * (`GUIA | DEBITO_AUTOMATICO | MANUAL | HISTORICO`) — aqui ela deixa de ser prosa e vira dado.
 *
 * Quem acrescentar uma via de baixa acrescenta a origem AQUI, e o teste de contrato passa a exigir
 * dela a mesma invariante das outras: estornar restaura o estado anterior por completo.
 */
export const ORIGENS_BAIXA_PARCELA = Object.freeze({
  /**
   * A prestação foi quitada pela via do DOCUMENTO. Hoje ninguém escreve este valor na coluna — quem
   * responde "foi quitada?" nesse caminho é a própria guia (`baixada`/`paymentStatus`), e a F2.1
   * evitou de propósito a segunda cópia do estado. O valor fica no vocabulário porque a âncora
   * existe e é estornável: é a via que `gerarPagamentoParcelaFromGuide` usa.
   */
  GUIA: Object.freeze({
    ancora: ANCORAS.GUIA,
    geraLancamento: true,
    escritaPor: "ParcelamentoV2Service.gerarPagamentoParcelaFromGuide (na GUIA, não na coluna)",
  }),
  /**
   * F2.2 — a via da DECLARAÇÃO: o contador sabe que o débito automático saiu da conta e lança.
   * Âncora = a própria prestação.
   */
  MANUAL: Object.freeze({
    ancora: ANCORAS.PARCELA,
    geraLancamento: true,
    escritaPor: "ParcelamentoV2Service.gerarPagamentoParcelaManual",
  }),
  /**
   * A via da PROVA, ainda NÃO IMPLEMENTADA: `DETPAGTOPARC165` (SERPRO) confirmando o débito
   * automático. Ela está declarada aqui de propósito — a âncora dela já é conhecida (a prestação,
   * pela chave `(numeroParcelamento, anoMesParcela)`), então o estorno dela já está coberto pelo
   * mesmo reversor. Quem a implementar não precisa escrever estorno nenhum; o que ele NÃO pode é
   * inventar uma âncora nova sem reversor.
   */
  DEBITO_AUTOMATICO: Object.freeze({
    ancora: ANCORAS.PARCELA,
    geraLancamento: true,
    escritaPor: "(ainda não existe — via SERPRO DETPAGTOPARC165)",
  }),
  /**
   * F2.3 — prestação quitada ANTES de o contrato entrar no sistema (parcelamento migrado de outra
   * contabilidade).
   *
   * ⚠ NÃO É ESTORNÁVEL POR AQUI, e não é omissão: ela **não gera `AccountingEntry`** (não houve
   * pagamento NOSSO para lançar), então não existe baixa a estornar. Desfazê-la é corrigir uma
   * DECLARAÇÃO de quantas prestações vieram pagas, não desfazer um fato contábil — e um estorno com
   * motivo e contra-lançamento sobre um lançamento que nunca existiu seria auditoria de ficção.
   */
  HISTORICO: Object.freeze({
    ancora: ANCORAS.PARCELA,
    geraLancamento: false,
    escritaPor: "ParcelamentoV2Service.marcarParcelasHistoricas",
    motivoNaoEstornavel:
      "não gera lançamento contábil (não houve pagamento nosso); desfazer é corrigir a declaração "
      + "de prestações já pagas na adesão, não estornar uma baixa",
  }),
});

/**
 * Os VALORES gravados em `parcelas.origemBaixa`, derivados das chaves do registro acima.
 *
 * ⚠ QUEM ESCREVE NA COLUNA IMPORTA DAQUI, e não escreve o literal. É isso que fecha o laço da fonte
 * única: com literais espalhados, uma via nova gravaria `"SEI_LA"` sem passar pelo registro, o
 * teste de contrato não teria o que iterar, e o estorno dela ficaria de fora sem ninguém ver.
 */
export const ORIGEM_BAIXA = Object.freeze(
  Object.fromEntries(Object.keys(ORIGENS_BAIXA_PARCELA).map((k) => [k, k])),
);

/** As origens que produzem lançamento de baixa — as que o estorno TEM de alcançar. */
export const ORIGENS_ESTORNAVEIS = Object.freeze(
  Object.entries(ORIGENS_BAIXA_PARCELA).filter(([, v]) => v.geraLancamento).map(([k]) => k),
);

/**
 * A ÂNCORA DE UM LANÇAMENTO DE BAIXA — lida do próprio lançamento, não de um parâmetro.
 *
 * ⚠ ISTO É O DESPACHO. É a mesma disciplina da guarda de custo do SERPRO: a identificação sai do
 * dado que já está na mão, então uma via de baixa escrita amanhã já nasce despachada certo sem
 * ninguém precisar lembrar de nada.
 *
 * A ordem importa e não é arbitrária: uma baixa de parcela COM guia carrega os dois vínculos
 * (`sourceGuideId` = a guia, `parcelamentoId` = o contrato), e a âncora dela é a GUIA — é a guia
 * que guarda `baixada`/`lancamentoId`/`parcelaEstado` e é ela que reabre. `parcelamentoId` sozinho,
 * sem guia, é a assinatura da baixa por declaração da F2.2.
 */
export function ancoraDoLancamento(entry) {
  if (entry?.sourceGuideId) return ANCORAS.GUIA;
  if (entry?.parcelamentoId) return ANCORAS.PARCELA;
  return ANCORAS.LANCAMENTO;
}
