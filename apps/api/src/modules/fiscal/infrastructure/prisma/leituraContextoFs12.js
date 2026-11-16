import { prisma } from '../../../../infrastructure/db/prisma.js';
import { interpretarContextoMensalFs12 } from '../../domain/contextoMensalFs12.js';
// Adaptador específico de leitura: PortalClient (ACL/URL) -> Company (cadastro).
// Sem fallback ao regime atual, sem import do módulo de emissão NFS-e.
export async function lerContextoFs12(db, { portalClientId, competencia }) {
  const portal = await db.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true } });
  if (!portal?.companyId) return null;
  const company = await db.company.findUnique({ where: { id: portal.companyId }, select: {
    id: true, dataAbertura: true, regimeHistorico: { select: {
      id: true, companyId: true, regime: true, vigenciaInicio: true, vigenciaFim: true, updatedAt: true,
    } },
  } });
  if (!company || company.id !== portal.companyId) return null;
  return interpretarContextoMensalFs12(company, competencia);
}

export function lerContextoFs12Consistente(entrada) {
  return prisma.$transaction(tx => lerContextoFs12(tx, entrada), { isolationLevel: 'RepeatableRead' });
}
