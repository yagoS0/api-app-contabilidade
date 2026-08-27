import { prisma } from "../../infrastructure/db/prisma.js";
import { SELECT_PARCELAMENTO_DA_GUIA } from "./guideContract.js";

// ⚠⚠ AS REGRAS PURAS SAÍRAM DAQUI EM 27/08/2026 e moram em `lib/recalculoDaGuia.js`.
//
// Elas sempre foram puras — `isGuideOverdue` decide se o SERPRO recebe `GERARDASCOBRANCA17` (DAS de
// cobrança, COM juros e multa) ou `GERARDAS12` —, mas viviam neste arquivo, que carrega o Prisma no
// topo. Resultado: nenhuma delas tinha um único teste, numa decisão que muda o valor a pagar.
//
// ⚠ A REEXPORTAÇÃO NÃO É COSMÉTICA: os cinco importadores (`GuideService`, `routes/firm/index.js`,
// `accountingEntries`, `SerproPaymentConfirmationService`, `SerproPgdasDeclaracaoService`) seguem
// importando daqui, sem uma linha de mudança. Trocar os imports em cinco arquivos junto com a
// extração misturaria refatoração e mudança de comportamento na mesma leitura.
export {
  getGuideDueDate,
  vencimentoDaGuia,
  isGuidePaid,
  isGuideOverdue,
  canGuideConfirmPayment,
  canGuideRecalculate,
  especieDoRecalculo,
  ESPECIE_RECALCULO,
  avisoDeRecalculo,
  leituraDosAcrescimos,
  ACRESCIMOS,
  PREFIXO_DARF_LP,
} from "./lib/recalculoDaGuia.js";

async function updateGuidePaymentStatus(guideId, data) {
  return prisma.guide.update({
    where: { id: String(guideId) },
    data,
    // A guia atualizada volta para a tela e substitui a linha da listagem. Sem o parcelamento junto,
    // confirmar o pagamento de uma PARCELA rebaixava o rótulo dela para o do DAS do mês — a linha
    // mudava de nome no clique, sem que nada tivesse mudado no banco.
    include: { parcelamento: { select: SELECT_PARCELAMENTO_DA_GUIA } },
  });
}

export async function markGuidePaidManual({ guideId, userId }) {
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "PAID",
    paymentStatusSource: "MANUAL",
    paymentConfirmedAt: new Date(),
    paymentConfirmedByUserId: String(userId),
    serproLastCheckResult: "MANUAL_CONFIRMED",
  });
}

export async function markGuidePaidBySerpro({ guideId }) {
  const now = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "PAID",
    paymentStatusSource: "SERPRO",
    serproLastCheckedAt: now,
    serproLastCheckResult: "NOT_FOUND",
    paymentConfirmedAt: null,
    paymentConfirmedByUserId: null,
  });
}

// Q40: pagamento confirmado pelo comprovante oficial (PAGTOWEB/COMPARRECADACAO).
// Diferente de markGuidePaidBySerpro (que usa a heurística "sem débito = pago"): aqui o
// SERPRO devolveu o comprovante de arrecadação, então gravamos paymentConfirmedAt + o PDF.
export async function markGuidePaidByComprovante({ guideId, comprovantePdfFileId = null }) {
  const now = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "PAID",
    paymentStatusSource: "SERPRO",
    paymentConfirmedAt: now,
    paymentConfirmedByUserId: null,
    serproLastCheckedAt: now,
    serproLastSeenAt: now,
    serproLastCheckResult: "COMPROVANTE_FOUND",
    ...(comprovantePdfFileId ? { comprovantePdfFileId } : {}),
  });
}

export async function markGuideOverdueBySerpro({ guideId }) {
  const now = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "OVERDUE",
    paymentStatusSource: "SERPRO",
    serproLastCheckedAt: now,
    serproLastSeenAt: now,
    serproLastCheckResult: "FOUND",
  });
}

/**
 * Guia continua EM ABERTO depois de uma consulta ao SERPRO.
 *
 * ⚠⚠ `checkResult` EXISTE PORQUE DUAS COISAS MUITO DIFERENTES CHAMAM ESTA FUNÇÃO, e até 20/08/2026
 * as duas gravavam a MESMA palavra — `"FOUND"`:
 *
 *   · o índice do PGDAS-D respondeu sobre a declaração e disse que o DAS **não consta pago**.
 *     Aí a Receita respondeu de fato, e `"FOUND"` descreve o que aconteceu;
 *   · o PAGTOWEB **não localizou** o comprovante. Aí não houve resposta nenhuma sobre o pagamento —
 *     e gravar `"FOUND"` registra, no banco e na tela, que o SERPRO ENCONTROU algo. Ele não
 *     encontrou. O contador lê esse valor cru na confirmação do próximo clique
 *     (`parcelaBusca.js`: "⚠ Esta guia já foi consultada em … (FOUND)").
 *
 * ⚠ AUSÊNCIA NÃO É PROVA DE NÃO-PAGAMENTO. Comprovante não localizado pode ser atraso de
 * processamento na Receita, número de documento errado, ou documento de outro tipo. Por isso a
 * distinção fica no REGISTRO — o `paymentStatus` continua `OPEN`, que é o estado em que a guia já
 * estava, e nada aqui marca inadimplência.
 */
export async function markGuideOpenBySerpro({ guideId, checkResult = "FOUND" }) {
  const now = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "OPEN",
    paymentStatusSource: "SERPRO",
    serproLastCheckedAt: now,
    serproLastSeenAt: now,
    serproLastCheckResult: checkResult,
  });
}

/** O que se grava quando o PAGTOWEB não localizou o comprovante. Vocabulário do mock desde sempre. */
export const CHECK_RESULT_NAO_LOCALIZADO = "NAO_LOCALIZADO";
