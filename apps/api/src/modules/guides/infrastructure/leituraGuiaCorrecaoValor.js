import { incluirProvisoesParaCorrecaoValor } from "../../accounting/public.js";

export function lerGuiaParaCorrecaoValor(db, companyId, guideId) {
  // A revisão inclui o objeto Prisma inteiro, na ordem original das relações.
  return db.guide.findFirst({
    where: { id: guideId, portalClientId: companyId },
    include: {
      accountingEntries: incluirProvisoesParaCorrecaoValor(),
      tributosParcela: { select: { id: true } },
    },
  });
}
