import { prisma } from "../../../../infrastructure/db/prisma.js";

export function lerGuiaParaCorrecaoValor(db = prisma, companyId, guideId, provisoes) {
  // A revisão inclui o objeto Prisma inteiro, na ordem original das relações.
  return db.guide.findFirst({
    where: { id: guideId, portalClientId: companyId },
    include: {
      accountingEntries: provisoes,
      tributosParcela: { select: { id: true } },
    },
  });
}
