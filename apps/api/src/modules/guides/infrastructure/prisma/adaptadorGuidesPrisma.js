import { prisma } from "../../../../infrastructure/db/prisma.js";

export function lerGuiaPorSourceFileId(sourceFileId) {
  return prisma.guide.findFirst({
    where: { sourceFileId },
    select: {
      id: true,
      paymentStatus: true,
      paymentStatusSource: true,
      paymentConfirmedAt: true,
    },
  });
}
