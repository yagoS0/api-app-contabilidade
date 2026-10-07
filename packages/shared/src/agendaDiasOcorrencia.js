import { somarDiasAgenda } from './agenda.js';

// Identidade nominal do cartão diário, inclusive quando um feriado desloca sua exibição.
export function diasDaOcorrencia(oc, serie = {}) {
  const config = { ...serie.agendaConfig, ...oc.agendaConfig };
  if (!config.horaInicio) return [];
  if (Array.isArray(config.diasAgendados)) return config.diasAgendados.map(d => d.dataInicioOriginal || d.dataInicio);
  const iso = d => d instanceof Date ? d.toISOString().slice(0,10) : String(d || '').slice(0,10);
  const inicio = config.dataInicioOriginal || iso(oc.dataInicio || oc.dataVencimento);
  const fim = config.dataFimOriginal || iso(oc.dataFim || oc.dataVencimento);
  const dias = [];
  for (let dia = inicio; dia && dia <= fim && dias.length < 367; dia = somarDiasAgenda(dia, 1)) dias.push(dia);
  return dias;
}

export function excluirDiaDaOcorrencia(oc, serie, dia, alcance) {
  const dias = diasDaOcorrencia(oc, serie);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || '') || !dias.includes(dia)) throw new Error('O dia selecionado não pertence a esta ocorrência. Atualize a agenda.');
  return [...new Set([...(oc.agendaConfig?.diasExcluidos || []), ...dias.filter(d => alcance === 'ESTA_E_PROXIMAS' ? d >= dia : alcance === 'ESTA_E_ANTERIORES' ? d <= dia : d === dia)])].sort();
}
