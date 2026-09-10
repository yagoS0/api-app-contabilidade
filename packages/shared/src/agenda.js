// Datas civis e períodos da agenda, compartilhados pelo servidor e pela demonstração.
export const FREQUENCIAS_AGENDA = ['AVULSA', 'DIARIA', 'SEMANAL', 'MENSAL', 'TRIMESTRAL', 'ANUAL'];
export const PRIORIDADES_AGENDA = ['', 'BAIXA', 'MEDIA', 'ALTA', 'URGENTE'];
const DIA = 86400000;
export function dataAgenda(valor) {
  const s = String(valor || '');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  if (!d || !Number.isFinite(+d) || d.toISOString().slice(0, 10) !== s) throw new Error('Informe uma data válida.');
  return s;
}
export const somarDiasAgenda = (data, dias) => new Date(+new Date(`${dataAgenda(data)}T00:00:00Z`) + dias * DIA).toISOString().slice(0, 10);
export function normalizarAgenda(dados = {}) {
  const dataInicio = dataAgenda(dados.dataInicio);
  const dataFim = dataAgenda(dados.dataFim || dataInicio);
  if (dataFim < dataInicio || (+new Date(dataFim) - +new Date(dataInicio)) / DIA > 366) throw new Error('O período deve ter até 366 dias e terminar após o início.');
  const recorrencia = dados.recorrencia || 'AVULSA';
  if (!FREQUENCIAS_AGENDA.includes(recorrencia)) throw new Error('Selecione uma recorrência válida.');
  const prioridade = dados.prioridade || '';
  if (!PRIORIDADES_AGENDA.includes(prioridade)) throw new Error('Selecione uma prioridade válida.');
  const hora = v => { if (v == null || v === '') return null; if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error('Informe um horário válido.'); return v; };
  const horaInicio = hora(dados.horaInicio), horaFim = hora(dados.horaFim);
  if (Boolean(horaInicio) !== Boolean(horaFim)) throw new Error('Preencha os dois horários.');
  if (horaInicio && dataInicio === dataFim && horaFim <= horaInicio) throw new Error('O horário final deve ser posterior ao inicial.');
  const repetirAte = dados.repetirAte ? dataAgenda(dados.repetirAte) : null;
  if (repetirAte && repetirAte < dataInicio) throw new Error('A repetição deve terminar após o início.');
  const fuso = dados.fuso || 'America/Sao_Paulo';
  if (fuso !== 'America/Sao_Paulo') throw new Error('Use o fuso do escritório: America/Sao_Paulo.');
  return { dataInicio, dataFim, horaInicio, horaFim, recorrencia, prioridade, repetirAte, fuso };
}
function diaDoMes(ano, mes, dia) {
  return new Date(Date.UTC(ano, mes, Math.min(dia, new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
}
/** Gera somente o intervalo solicitado. Cancelamentos são aplicados pelo chamador. */
export function expandirAgenda(config, inicio, fim) {
  const c = normalizarAgenda(config); dataAgenda(inicio); dataAgenda(fim);
  if (fim < inicio || (+new Date(fim) - +new Date(inicio)) / DIA > 740) throw new Error('Consulte um intervalo de até dois anos.');
  const duracao = Math.round((+new Date(c.dataFim) - +new Date(c.dataInicio)) / DIA);
  const resultado = [];
  const adicionar = (dataInicio, dataFim, cicloChave) => {
    if (dataInicio < c.dataInicio || (c.repetirAte && dataInicio > c.repetirAte) || dataFim < inicio || dataInicio > fim) return;
    resultado.push({ ...c, dataInicio, dataFim, cicloChave });
  };
  if (c.recorrencia === 'AVULSA') adicionar(c.dataInicio, c.dataFim, c.dataInicio);
  else if (['DIARIA', 'SEMANAL'].includes(c.recorrencia)) {
    const passo = c.recorrencia === 'DIARIA' ? 1 : 7;
    const offset = Math.max(0, Math.ceil(((+new Date(inicio) - +new Date(c.dataInicio)) / DIA - duracao) / passo));
    for (let d = somarDiasAgenda(c.dataInicio, offset * passo); d <= fim; d = somarDiasAgenda(d, passo)) adicionar(d, somarDiasAgenda(d, duracao), d);
  } else {
    const [ano, mes, dia] = c.dataInicio.split('-').map(Number);
    const [anoFim, mesFim, diaFim] = c.dataFim.split('-').map(Number);
    const diferencaMeses = (anoFim - ano) * 12 + mesFim - mes;
    const passo = c.recorrencia === 'ANUAL' ? 12 : c.recorrencia === 'TRIMESTRAL' ? 3 : 1;
    const min = new Date(`${inicio}T00:00:00Z`), max = new Date(`${fim}T00:00:00Z`);
    const primeiro = Math.max(0, Math.floor(((min.getUTCFullYear() - ano) * 12 + min.getUTCMonth() - mes + 1 - diferencaMeses) / passo));
    for (let n = primeiro; ; n++) {
      const base = new Date(Date.UTC(ano, mes - 1 + n * passo, 1));
      if (base > max) break;
      const a = base.getUTCFullYear(), m = base.getUTCMonth();
      adicionar(diaDoMes(a, m, dia), diaDoMes(a, m + diferencaMeses, diaFim), base.toISOString().slice(0, 7));
    }
  }
  return resultado;
}

/** Exceções movidas continuam visíveis no destino, mesmo fora do período original. */
export function ocorrenciasDaTarefa(tarefa, inicio, fim) {
  const mapa = new Map(expandirAgenda(tarefa.config, inicio, fim).map(o => [o.cicloChave, o]));
  for (const [chave, estado] of Object.entries(tarefa.estados || {})) {
    if (!estado.alteracoes || estado.canceladaEm || mapa.has(chave)) continue;
    const referencia = chave.length === 7 ? `${chave}-01` : chave;
    const oc = expandirAgenda(tarefa.config, referencia, somarDiasAgenda(referencia, 31)).find(o => o.cicloChave === chave);
    if (oc) mapa.set(chave, oc);
  }
  return [...mapa.values()].flatMap(oc => {
    const estado = tarefa.estados?.[oc.cicloChave] || {};
    const item = { ...oc, ...estado.alteracoes, id: `${tarefa.id}:${oc.cicloChave}`, tarefaId: tarefa.id, fonte: 'TAREFA', tipo: 'tarefa', titulo: estado.alteracoes?.titulo || tarefa.titulo, descricao: estado.alteracoes?.descricao ?? tarefa.descricao, resolvido: Boolean(estado.concluidaEm), concluidaEm: estado.concluidaEm || null };
    return estado.canceladaEm || item.dataFim < inicio || item.dataInicio > fim ? [] : [item];
  });
}
