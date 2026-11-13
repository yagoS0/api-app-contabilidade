export async function lerCompetenciasFechadas(client, portalClientId, competencias) {
  const alvo = [...new Set((competencias || []).filter(Boolean).map(String))];
  if (!portalClientId || !alvo.length) return new Set();
  const linhas = await client.companyMonthlyCircular.findMany({
    where: { portalClientId: String(portalClientId), competencia: { in: alvo } },
    select: { competencia: true, fechadoContabilEm: true },
  });
  return new Set(linhas.filter((l) => l.fechadoContabilEm).map((l) => l.competencia));
}
