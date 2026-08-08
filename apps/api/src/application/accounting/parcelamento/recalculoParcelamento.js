// RECÁLCULO DO PARCELAMENTO — parcelas pagas, atraso e alerta de rescisão.
//
// ⚠ ESTE ARQUIVO NÃO CALCULA A REGRA DE RESCISÃO. Ele reúne as parcelas e chama
// `avaliarRiscoRescisao` (`riscoRescisao.js`), que já traz a regra da IN RFB 2.063/2022 como DADO
// da modalidade, com os dois casos (I e II) e a marca `citacaoConferida:false`. Uma segunda
// implementação daquela conta é a última coisa que este módulo pode ter: as duas divergiriam, e o
// contador veria "tudo em dia" numa tela e "rescindível" na outra, sobre a mesma empresa.
//
// Por que ele existe, então: o risco só era calculado no caminho de LEITURA
// (`decorateParcelamento`, ao listar parcelamentos). O estorno precisa da mesma resposta na hora em
// que desfaz a baixa — para devolvê-la a quem clicou e para gravá-la na auditoria. Sem isso, a
// resposta do estorno diria "pronto" e o contador só descobriria que acabou de empurrar a empresa
// para a terceira prestação em atraso na próxima vez que abrisse a tela de parcelamentos.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { avaliarRiscoRescisao } from "./riscoRescisao.js";

/**
 * A prestação está QUITADA para efeito da regra de rescisão?
 *
 * ⚠ `baixada` entra junto com `PAID` de propósito, e o critério é o mesmo de `decorateParcelamento`
 * — está aqui, exportado, para que haja UM predicado e não dois. Pagamento PARCIAL não quita: quem
 * paga parcial não marca `PAID`, e para a RFB a prestação segue inadimplida (é a divergência mais
 * cara do fluxo, documentada em `riscoRescisao.js`).
 */
export function parcelaQuitada(guide) {
  return String(guide?.paymentStatus || "").toUpperCase() === "PAID" || Boolean(guide?.baixada);
}

/**
 * F2.1 — o mesmo predicado, agora perguntado à PARCELA.
 *
 * ⚠ ELE NÃO REESCREVE `parcelaQuitada`, ELE O CHAMA. Enquanto o caminho de baixa for por guia
 * (`gerarPagamentoParcelaFromGuide` exige `guideId`), a autoridade sobre "foi paga?" continua sendo
 * a guia; a parcela não guarda cópia de `baixada`/`paymentStatus` justamente para não haver duas
 * respostas divergindo no primeiro estorno.
 *
 * `origemBaixa` é o outro caminho, e hoje ele é sempre nulo: é onde a F2.2 vai gravar a baixa de uma
 * parcela que nunca teve guia (débito automático). Estando lido aqui, a F2.2 muda UMA escrita e
 * todas as derivações passam a enxergar a quitação sozinhas.
 */
export function parcelaRowQuitada(parcela) {
  if (parcela?.origemBaixa) return true;
  return parcela?.guia ? parcelaQuitada(parcela.guia) : false;
}

/**
 * Existe ALGUMA evidência sobre o pagamento desta prestação?
 *
 * ⚠ ESTA É A DISTINÇÃO QUE A TABELA `parcelas` TORNOU POSSÍVEL — E A QUE IMPEDE UM ALERTA FALSO.
 * Antes, uma prestação sem guia simplesmente não existia, então nunca entrava na conta. Agora ela
 * existe; e se entrasse como "não quitada", TODO parcelamento em débito automático (que não tem
 * guia nenhuma, por definição) apareceria com dezenas de prestações em atraso e sairia
 * RESCINDÍVEL — inadimplência inventada a partir de ausência de dado, que é a regra 1 do dono ao
 * contrário. E um alerta que acende em todo mundo é o alerta que ninguém lê, que é exatamente o
 * que `riscoRescisao.js` já se recusa a fazer com parcela futura.
 *
 * Ausência de guia não é prova de não-pagamento. Sem guia e sem `origemBaixa`, a prestação fica
 * FORA do cálculo de risco e é reportada em `parcelasSemEvidencia` — visível, nomeada, não contada.
 */
export function temEvidenciaDePagamento(parcela) {
  return Boolean(parcela?.origemBaixa) || Boolean(parcela?.guia);
}

/**
 * F2.1 — O QUADRO DO PARCELAMENTO, DERIVADO DE UMA FONTE SÓ.
 *
 * Antes o numerador vinha das GUIAS e o denominador de outro lugar; quem não tinha guia era
 * invisível no primeiro e presente no segundo. Aqui os dois saem da MESMA lista de parcelas, e é
 * essa a correção: `parcelasTotal` são as prestações CONTRATADAS, `parcelasPagas` são aquelas
 * dentre elas com evidência de quitação.
 *
 * ⚠ O vencimento resolve `guia.vencimento ?? parcela.vencimento`: quando há guia, o vencimento REAL
 * é o dela (veio do SERPRO/PDF); o da parcela é o cronograma CONTRATADO, um plano. Uma cópia do
 * vencimento da guia dentro da parcela envelheceria no primeiro recálculo do SERPRO.
 *
 * @param {Array} parcelas linhas de `parcelas`, cada uma com `guia` incluída (ou nula)
 */
export function quadroDasParcelas(parcelas, { status = null, agora = new Date() } = {}) {
  const lista = Array.isArray(parcelas) ? parcelas : [];
  const comEvidencia = lista.filter(temEvidenciaDePagamento);

  return {
    parcelasPagas: lista.filter(parcelaRowQuitada).length,
    parcelasTotal: lista.length,
    parcelasSemEvidencia: lista.length - comEvidencia.length,
    risco: status === "RESCINDIDO"
      ? null
      : avaliarRiscoRescisao({
        parcelas: comEvidencia.map((p) => ({
          numeroParcela: p.numeroParcela ?? null,
          vencimento: p.guia?.vencimento ?? p.vencimento,
          quitada: parcelaRowQuitada(p),
        })),
        agora,
      }),
  };
}

/** O que as derivações precisam ler de cada parcela — uma lista só, para não divergirem. */
export const SELECT_PARCELA_PARA_QUADRO = Object.freeze({
  id: true,
  numeroParcela: true,
  vencimento: true,
  origemBaixa: true,
  guia: { select: { id: true, vencimento: true, paymentStatus: true, baixada: true } },
});

/**
 * Recalcula o quadro do parcelamento DEPOIS de um estorno (ou de qualquer mudança de baixa).
 *
 * Lê as PARCELAS do parcelamento (F2.1 — antes eram as guias) e devolve o que muda o dia do
 * contador: quantas prestações estão quitadas, quantas venceram sem pagamento, quantas não têm
 * evidência nenhuma e em que nível de risco o acordo está.
 *
 * ⚠ Parcelamento já RESCINDIDO não é avaliado (`risco: null`) — não há mais o que prevenir. Mesma
 * decisão de `decorateParcelamento`.
 *
 * @param {object} client prisma OU um `tx` — o estorno chama de DENTRO da transação, para que o
 *   número gravado na auditoria seja o do estado já estornado, e não o de antes.
 */
export async function recalcularParcelamento(client, { portalClientId, parcelamentoId, agora = new Date() }) {
  if (!parcelamentoId) return null;
  const parc = await client.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
    select: { id: true, status: true, numParcelas: true },
  });
  if (!parc) return null;

  // ⚠ F2.1 — A FONTE MUDOU DE `guide` PARA `parcela`, E A REGRA NÃO.
  //
  // Antes: `parcelasTotal: guides.length || parc.numParcelas` — numerador e denominador de fontes
  // DIFERENTES, com um `||` escolhendo entre elas. Um parcelamento de 52 prestações com 3 guias
  // capturadas reportava "1 de 3"; um sem guia nenhuma reportava "0 de 52" e um risco calculado
  // sobre lista vazia. Agora as duas pontas saem da mesma lista de parcelas contratadas.
  //
  // ⚠ `vencimento` continua sendo o que decide o atraso, e ele é resolvido em `quadroDasParcelas`
  // como `guia.vencimento ?? parcela.vencimento` — o real quando existe, o contratado quando não.
  const parcelas = await client.parcela.findMany({
    where: { parcelamentoId, portalClientId },
    select: SELECT_PARCELA_PARA_QUADRO,
  });

  const quadro = quadroDasParcelas(parcelas, { status: parc.status, agora });

  return {
    parcelamentoId,
    status: parc.status,
    parcelasPagas: quadro.parcelasPagas,
    parcelasTotal: quadro.parcelasTotal,
    parcelasSemEvidencia: quadro.parcelasSemEvidencia,
    emAtraso: quadro.risco?.emAtraso ?? null,
    risco: quadro.risco,
  };
}
