// Interpretação conservadora dos fatos cadastrais; não decide tributação nem amplia vigências.
export function interpretarContextoMensalFs12(company, competencia) {
  const iso = value => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
  const inicio = `${competencia}-01`;
  const [ano, mes] = competencia.split('-').map(Number);
  const fim = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  // Datas do cadastro são civis armazenadas em UTC. Instantes não normalizados
  // não são promovidos a vigência mensal por inferência.
  const civil = value => { const s = iso(value); return s?.endsWith('T00:00:00.000Z') ? s.slice(0, 10) : null; };
  const historico = company.regimeHistorico || [];
  const datasValidas = historico.every(h => civil(h.vigenciaInicio)
    && (h.vigenciaFim == null || (civil(h.vigenciaFim) && civil(h.vigenciaFim) >= civil(h.vigenciaInicio))));
  const candidatos = datasValidas ? historico.filter(h => civil(h.vigenciaInicio) <= fim
    && (h.vigenciaFim == null || civil(h.vigenciaFim) >= inicio)) : [];
  const h = candidatos.length === 1 ? candidatos[0] : null;
  const tipos = { SIMPLES: 'SIMPLES_NACIONAL', LUCRO_PRESUMIDO: 'LUCRO_PRESUMIDO', LUCRO_REAL: 'LUCRO_REAL', MEI: 'MEI' };
  const integral = h && h.companyId === company.id && civil(h.vigenciaInicio) <= inicio
    && (h.vigenciaFim == null || civil(h.vigenciaFim) >= fim) && tipos[h.regime] && h.id && iso(h.updatedAt);
  return { empresaId: company.id, competenciaApuracao: competencia,
    inicioAtividade: civil(company.dataAbertura)?.slice(0, 7) ?? null,
    regimeDoPeriodo: integral ? { empresaId: company.id, competencia, tipo: tipos[h.regime],
      referencia: `RegimeHistorico:${h.id}:${iso(h.updatedAt)}` } : null };
}
