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
 * Recalcula o quadro do parcelamento DEPOIS de um estorno (ou de qualquer mudança de baixa).
 *
 * Lê as guias do parcelamento e devolve o que muda o dia do contador: quantas prestações estão
 * quitadas, quantas venceram sem pagamento e em que nível de risco o acordo está.
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

  // ⚠ `vencimento` é o que decide se a prestação está em atraso; sem ele o risco sai como "não
  // avaliável" em todo parcelamento.
  const guides = await client.guide.findMany({
    where: { parcelamentoId, portalClientId },
    select: { id: true, numeroParcela: true, vencimento: true, paymentStatus: true, baixada: true },
  });

  const parcelasPagas = guides.filter(parcelaQuitada).length;
  const risco = parc.status === "RESCINDIDO"
    ? null
    : avaliarRiscoRescisao({
      parcelas: guides.map((g) => ({
        numeroParcela: g.numeroParcela ?? null,
        vencimento: g.vencimento,
        quitada: parcelaQuitada(g),
      })),
      agora,
    });

  return {
    parcelamentoId,
    status: parc.status,
    parcelasPagas,
    parcelasTotal: guides.length || parc.numParcelas || 0,
    emAtraso: risco?.emAtraso ?? null,
    risco,
  };
}
