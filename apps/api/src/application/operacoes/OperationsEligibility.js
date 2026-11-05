// Diagnóstico local do atalho NFS-e. Não concede autorização de cálculo/transmissão.
const civil = value => {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
};

export function regimeDoPeriodo(history, competencia) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(competencia || '') || !Array.isArray(history)) return null;
  const [year, month] = competencia.split('-').map(Number);
  const start = `${competencia}-01`, end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  // Um registro sem datas válidas não pode ser descartado como se não sobrepusesse o período.
  if (history.some(row => !civil(row.vigenciaInicio) || row.vigenciaFim != null && (!civil(row.vigenciaFim) || civil(row.vigenciaFim) < civil(row.vigenciaInicio)))) return null;
  const relevant = history.filter(row => civil(row.vigenciaInicio) <= end && (row.vigenciaFim == null || civil(row.vigenciaFim) >= start));
  if (relevant.length !== 1 || civil(relevant[0].vigenciaInicio) > start || relevant[0].vigenciaFim != null && civil(relevant[0].vigenciaFim) < end) return null;
  return ({ SIMPLES: 'SIMPLES', LUCRO_PRESUMIDO: 'PRESUMIDO', LUCRO_REAL: 'REAL', MEI: 'MEI' })[relevant[0].regime] || null;
}

export function avaliarAuditoriaNfse(audit, companyId, competencia) {
  if (!audit || audit.empresa?.portalClientId !== companyId || audit.competencia !== competencia) return { status: 'INCOMPLETE', reason: 'Identidade ou competência da auditoria não comprovada.' };
  const questions = audit.perguntas;
  if (!Array.isArray(questions) || questions.length !== 3 || new Set(questions.map(p => p?.id)).size !== 3
    || !Number.isInteger(audit.totalAchados) || audit.totalAchados < 0
    || !Number.isInteger(audit.foraDaConferencia?.total) || audit.foraDaConferencia.total < 0
    || !Number.isInteger(audit.manutencao?.notasNaoLidas) || audit.manutencao.notasNaoLidas < 0
    || questions.some(p => !p?.id || !Array.isArray(p.achados) || !Array.isArray(p.naoAvaliadas))) {
    return { status: 'INCOMPLETE', reason: 'Auditoria NFS-e incompleta; ausência não comprova base válida.' };
  }
  if (audit.manutencao.notasNaoLidas || audit.foraDaConferencia.total) return { status: 'INCOMPLETE', reason: 'Há notas não lidas ou sem competência. Confira a auditoria NFS-e.' };
  if (questions.some(p => p.situacao !== 'CONFERIDA' || p.naoAvaliadas.length)) return { status: 'INCOMPLETE', reason: 'Existem verificações NFS-e não concluídas.' };
  return { status: audit.totalAchados ? 'REVIEW' : 'COMPLETE', reason: null, totalAchados: audit.totalAchados,
    warnings: questions.filter(p => p.achados.length).map(p => p.titulo || p.id) };
}

export function regimeComprovado(history, competencia, cadastro, company) {
  if (history?.length) return regimeDoPeriodo(history, competencia);
  const opcao = civil(cadastro?.dataOpcaoSN);
  if (cadastro?.regime === 'SIMPLES_NACIONAL' && ['SIMPLES', 'SIMPLES_NACIONAL'].includes(company?.regimeTributario)
      && opcao && opcao <= `${competencia}-01`) return 'SIMPLES';
  return null;
}
