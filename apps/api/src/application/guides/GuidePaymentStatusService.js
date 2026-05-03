import { prisma } from "../../infrastructure/db/prisma.js";

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

export function canGuideRecalculate(guide, now = new Date()) {
  if (normalizeValue(guide?.source) !== "SERPRO") return false;
  if (normalizeValue(guide?.tipo) !== "SIMPLES") return false;
  if (isGuidePaid(guide)) return false;
  return isGuideOverdue(guide, now);
}

async function updateGuidePaymentStatus(guideId, data) {
  return prisma.guide.update({
    where: { id: String(guideId) },
    data,
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

export async function markGuideOpenBySerpro({ guideId }) {
  const now = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "OPEN",
    paymentStatusSource: "SERPRO",
    serproLastCheckedAt: now,
    serproLastSeenAt: now,
    serproLastCheckResult: "FOUND",
  });
}
