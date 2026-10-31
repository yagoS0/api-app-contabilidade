// Civil dates are validated before formatting; normalization must not invent a day.
export function operationDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(String(value || ''));
  if (!match) return 'A verificar';
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) return 'A verificar';
  if (String(value).includes('T') && !Number.isFinite(Date.parse(value))) return 'A verificar';
  return `${d}/${m}/${y}`;
}

export function operationMoney(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value))) return 'Não disponível';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function operationInstant(value) {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(String(value || '')) || operationDate(value) === 'A verificar') return 'A verificar';
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)';
}

// Availability of evidence is separate from the accountant's assessment of findings.
// The future transmission extract is intentionally not a confirmation prerequisite.
export function approvalEvidenceError(operation, { historical = false } = {}) {
  const details = operation?.details;
  for (const [key, label] of [['snapshot', 'cálculo salvo'], ['auditoria', 'auditoria de notas']]) {
    if (details?.[key]?.error) return `Leitura de ${label}: ${details[key].error}`;
    if (!details?.[key]?.value) return `Leitura de ${label}: evidência ausente`;
  }
  const snapshot = details.snapshot.value, audit = details.auditoria.value;
  if (snapshot.portalClientId !== operation.companyId || snapshot.competencia !== operation.competencia || audit.competencia !== operation.competencia) return 'Evidências de empresa ou competência incompatíveis';
  // Completed execution can legitimately have a transmitted snapshot and no
  // recoverable calculation DTO. This exception is presentation-only.
  if (historical && operation.status === 'EXECUTED' && snapshot.estado === 'transmitida') return null;
  if (operation.status === 'EXECUTED') return 'Execução já concluída; nova liberação indisponível';
  if (!['calculada', 'fechada'].includes(snapshot.estado) || !snapshot.idempotencyKey || !operation.calculation?.calculoId || snapshot.idempotencyKey !== operation.calculation.calculoId) return 'Revisão do cálculo não corresponde à operação carregada';
  return null;
}

export async function readCalculationDetails(api, companyId, competencia) {
  const sources = [
    ['snapshot', 'getApuracaoSnapshot'], ['auditoria', 'getAuditoriaNotas'], ['history', 'getPgdasHistorico'],
  ];
  const entries = await Promise.all(sources.map(async ([key, method]) => {
    try {
      if (!api?.[method]) throw Error('Leitura indisponível nesta conexão');
      const response = await api[method](companyId, competencia);
      if (!response || response.ok === false) throw Error('Resposta inválida');
      const value = key === 'history' ? response : response[key];
      if (value === undefined || (value && value.competencia !== competencia) || (key === 'snapshot' && value && value.portalClientId !== companyId) || (value?.companyId && value.companyId !== companyId) || (value?.portalClientId && value.portalClientId !== companyId)) throw Error('Identidade ou período incompatível');
      if (value && (typeof value !== 'object' || Array.isArray(value))) throw Error('Formato da fonte inválido');
      if (key === 'history' && !Array.isArray(value?.versoes)) throw Error('Histórico sem lista de versões');
      if (key === 'history' && value.versoes.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw Error('Versão do histórico inválida');
      if (key === 'snapshot' && value && (!value.estado || !value.idempotencyKey || operationMoney(value.dasSimuladoSerpro) === 'Não disponível')) throw Error('Cálculo salvo incompleto');
      if (key === 'snapshot' && value?.atividadesEscolhidas != null && (!Array.isArray(value.atividadesEscolhidas) || value.atividadesEscolhidas.some(a => !a || typeof a !== 'object' || Array.isArray(a)))) throw Error('Formulário salvo inválido');
      if (key === 'auditoria' && value && (!Array.isArray(value.perguntas) || !Number.isInteger(value.totalAchados) || value.totalAchados < 0 || value.perguntas.some(p => !p || !p.id || !p.situacao || !Array.isArray(p.achados) || !Array.isArray(p.naoAvaliadas)))) throw Error('Auditoria inválida');
      return [key, { value }];
    } catch (e) { return [key, { error: e.message }]; }
  }));
  return Object.fromEntries(entries);
}

export function reconcileOperationGuides(guides, row, competencia) {
  const scoped = guides.filter(g => g.companyId === row.company.companyId && g.competencia === competencia);
  const byId = new Map();
  for (const guide of scoped) {
    if (!guide.guideId) continue;
    if (byId.has(guide.guideId)) throw Error('Documento repetido no retorno. Atualize as guias antes de continuar.');
    byId.set(guide.guideId, guide);
  }
  const missing = (row.guideSummary?.items || []).filter(item => !item.guideId || !byId.has(item.guideId));
  return { guides: [...byId.values()], missing };
}

