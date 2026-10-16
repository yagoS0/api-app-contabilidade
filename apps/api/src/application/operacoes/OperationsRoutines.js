import { ROTINA_KEYS } from '../fiscal/serpro/SerproRuntimeSettings.js';
import { ROTINA_LABELS } from '../fiscal/serpro/CompanyRotinasService.js';
import { aplicarRegimeRotinas, labelRotinaAplicavel } from '../fiscal/serpro/CompanyRoutineApplicability.js';

// Projeção somente local das escolhas explícitas. Ausência nunca habilita rotina.
export async function listarRotinasOperacoes(db, companyIds) {
  const portalRows = await db.portalClient.findMany({
    where: { id: { in: companyIds } }, select: { id: true, companyId: true },
  });
  const legacyIds = portalRows.map(row => row.companyId).filter(Boolean);
  const legacyRows = legacyIds.length ? await db.company.findMany({
    where: { id: { in: legacyIds } }, select: { id: true, regimeTributario: true, tipoTributario: true },
  }) : [];
  const legacyMap = new Map(legacyRows.map(row => [row.id, row]));
  const portalMap = new Map(portalRows.map(row => [row.id, row]));
  const rows = await db.companyRotina.findMany({
    where: { portalClientId: { in: companyIds }, rotina: { in: ROTINA_KEYS } },
    select: { portalClientId: true, rotina: true, enabled: true },
  });
  const byCompany = new Map(companyIds.map(id => [id, []]));
  for (const row of rows) {
    if (row.enabled === true && byCompany.has(row.portalClientId)) byCompany.get(row.portalClientId).push(row.rotina);
  }
  return { items: [...byCompany].map(([companyId, storedEnabledKeys]) => {
    const applicability = aplicarRegimeRotinas(legacyMap.get(portalMap.get(companyId)?.companyId));
    return { companyId, ...applicability, storedEnabledKeys,
      enabledKeys: storedEnabledKeys.filter(key => applicability.applicableKeys.includes(key)) };
  }), routines: ROTINA_KEYS.map(key => ({ key, label: labelRotinaAplicavel(key, ROTINA_LABELS) })) };
}
