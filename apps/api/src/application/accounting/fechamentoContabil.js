// Q18: fechamento contábil — utilitário compartilhado.
// Uma competência está FECHADA quando CompanyMonthlyCircular.fechadoContabilEm != null.
// Mês fechado bloqueia novos lançamentos e upload/registro de guias naquele mês.
import { prisma } from "../../infrastructure/db/prisma.js";

export async function isMonthClosed(portalClientId, competencia) {
  if (!portalClientId || !competencia) return false;
  const circ = await prisma.companyMonthlyCircular.findUnique({
    where: { portalClientId_competencia: { portalClientId: String(portalClientId), competencia: String(competencia) } },
    select: { fechadoContabilEm: true },
  });
  return Boolean(circ?.fechadoContabilEm);
}
