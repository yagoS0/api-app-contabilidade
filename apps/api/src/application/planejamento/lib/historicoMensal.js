const numero = v => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
// Somente dados já salvos. Simulação oficial, transmissão e pagamento são fatos diferentes.
export function historicoMensalDosSnapshots(snapshots = []) {
  const mapa = new Map();
  for (const s of snapshots) {
    if (!/^\d{4}-\d{2}$/.test(s.competencia)) continue;
    const interna = numero(s.receitaInterna);
    const externa = numero(s.receitaExterna);
    const tipos = Object.values(s.receitaPorTipo || {}).map(numero);
    const receita = interna != null && externa != null ? interna + externa
      : tipos.length && tipos.every(v => v != null) ? tipos.reduce((a, b) => a + b, 0) : null;
    const transmitido = ["transmitida", "confirmada"].includes(s.estado) ? numero(s.dasRetornadoSerpro) : null;
    const local = s.dasCalculadoLocalProcedencia === "MOTOR_LOCAL" ? numero(s.dasCalculadoLocal) : null;
    mapa.set(s.competencia, { ...(mapa.get(s.competencia) || {}), competencia: s.competencia, receita,
      tributoApurado: transmitido ?? local,
      origem: `apuração salva (${s.estado})`,
      origemTributo: transmitido != null ? "transmitido" : local != null ? "calculado localmente" : null });
    for (const [pa, bruto] of Object.entries(s.folhaMensal12 || {})) {
      const competencia = /^\d{6}$/.test(pa) ? `${pa.slice(0, 4)}-${pa.slice(4)}` : pa;
      const folha = numero(bruto);
      if (!/^\d{4}-\d{2}$/.test(competencia) || folha == null) continue;
      mapa.set(competencia, { ...(mapa.get(competencia) || { competencia, receita: null, tributoApurado: null }), folha });
    }
  }
  return [...mapa.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}
