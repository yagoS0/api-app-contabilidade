import { ROTINA_KEYS } from '../fiscal/serpro/SerproRuntimeSettings.js';
import { ROTINA_LABELS } from '../fiscal/serpro/CompanyRotinasService.js';

// Projeção somente local das escolhas explícitas. Ausência nunca habilita rotina.
export async function listarRotinasOperacoes(db, companyIds) {
  const rows = await db.companyRotina.findMany({
    where: { portalClientId: { in: companyIds }, rotina: { in: ROTINA_KEYS } },
    select: { portalClientId: true, rotina: true, enabled: true },
  });
  const byCompany = new Map(companyIds.map(id => [id, []]));
  for (const row of rows) {
    if (row.enabled === true && byCompany.has(row.portalClientId)) byCompany.get(row.portalClientId).push(row.rotina);
  }
  return { items: [...byCompany].map(([companyId, enabledKeys]) => ({ companyId, enabledKeys })),
    routines: ROTINA_KEYS.map(key => ({ key, label: ROTINA_LABELS[key] })) };
}
