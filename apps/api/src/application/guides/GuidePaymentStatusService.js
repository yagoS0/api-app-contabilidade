import { prisma } from "../../infrastructure/db/prisma.js";
import { SELECT_PARCELAMENTO_DA_GUIA } from "./guideContract.js";

function normalizeValue(value) {
  return String(value || "").trim().toUpperCase();
}

export function getGuideDueDate(guide, now = new Date()) {
  if (guide?.vencimento) return new Date(guide.vencimento);
  const competencia = String(guide?.competencia || "").trim();
  const match = competencia.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return null;
  return new Date(Date.UTC(year, monthIndex + 1, 20, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
}

export function isGuidePaid(guide) {
  return normalizeValue(guide?.paymentStatus) === "PAID";
}

export function isGuideOverdue(guide, now = new Date()) {
  if (normalizeValue(guide?.paymentStatus) === "OVERDUE") return true;
  const dueDate = getGuideDueDate(guide, now);
  if (!dueDate) return false;
  return dueDate.getTime() < now.getTime();
}

export function canGuideConfirmPayment(guide) {
  return !isGuidePaid(guide);
}

// Q29: recálculo liberado para QUALQUER guia SIMPLES do SERPRO ainda não paga —
// vencida OU em aberto. O serviço SERPRO certo (COBRANCA17 vs GERARDAS12) é
// escolhido na rota conforme o vencimento. (Antes exigia isGuideOverdue.)
export function canGuideRecalculate(guide) {
  if (normalizeValue(guide?.source) !== "SERPRO") return false;
  if (normalizeValue(guide?.tipo) !== "SIMPLES") return false;
  if (isGuidePaid(guide)) return false;
  return true;
}

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
