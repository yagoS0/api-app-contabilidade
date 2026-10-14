// Identifica o aviso exibido; não altera a execução nem a trava do agendamento.
export function chaveAvisoRotina(row) {
  const run = row?.lastRun;
  if (!run) return null;
  return JSON.stringify([row.routine, run.id || run.scheduledAt || run.startedAt || null, run.finishedAt || null, run.status, run.error || null, run.result ?? null]);
}
function temResultadoIncerto(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => {
    if (['interrupted', 'indeterminado', 'incerto', 'outcomeUnknown'].includes(key) && item === true) return true;
    if (typeof item === 'string' && ['status', 'code', 'error', 'reason'].includes(key) && /INDETERMIN|INCERT|CONSULTA_NAO_CONCLUIDA|LEASE_LOST|interrompid|sem conclus[aã]o|sem resposta/i.test(item)) return true;
    return typeof item === 'object' && temResultadoIncerto(item);
  });
}
export function elegivelLimparAviso(row) {
  const run = row?.lastRun;
  return Boolean(run?.status === 'FAILED' && run.finishedAt && Number.isFinite(Date.parse(run.finishedAt)) && !row.interrupted && !temResultadoIncerto(run));
}
export function estadoExecucaoRotina(row, visto = false) {
  if (!row.enabled) return 'Desativada';
  if (row.interrupted) return 'Execução interrompida';
  if (!row.alive) return 'Sem sinal do executor';
  if (row.lastRun?.status === 'RUNNING') return 'Em execução';
  if (row.lastRun?.status === 'FAILED') return visto && elegivelLimparAviso(row) ? 'Falha já vista' : 'Consultar falha';
  if (row.overdue) return 'Horário não executado';
  return 'Aguardando horário';
}
