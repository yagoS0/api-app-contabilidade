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
  if (horaFim && !horaInicio) throw new Error('Informe o horário inicial.');
  if (horaInicio && horaFim && dataInicio === dataFim && horaFim <= horaInicio) throw new Error('O horário final deve ser posterior ao inicial.');
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

// Uma tarefa com horário ocupa o mesmo horário em cada dia inclusivo da janela.
// A chave de cada dia permanece ligada ao ciclo original, mesmo após mover a tarefa.
export function diasDaTarefa(item) {
  if (!item.horaInicio || item.dataInicio === item.dataFim) return [item];
  // Compatibilidade com intervalos antigos que atravessavam a noite.
  if (item.horaFim && item.horaFim <= item.horaInicio) return [item];
  const dias = [];
  for (let dia = item.dataInicio; dia <= item.dataFim; dia = somarDiasAgenda(dia, 1)) {
    dias.push({ ...item, dataInicio: dia, dataFim: dia, cicloChave: `${item.cicloChave}@${dia}` });
  }
  return dias;
}

function itensDoCiclo(tarefa, oc) {
  const pendentes = [{ ...oc, titulo: tarefa.titulo, descricao: tarefa.descricao, concluidaEm: null }], itens = [];
  while (pendentes.length) {
    const original = pendentes.pop(), estado = tarefa.estados?.[original.cicloChave] || {};
    if (estado.canceladaEm) continue;
    const item = { ...original, ...estado.alteracoes, concluidaEm: Object.hasOwn(estado, 'concluidaEm') ? estado.concluidaEm : original.concluidaEm };
    const dias = diasDaTarefa(item);
    if (dias.length > 1) { pendentes.push(...dias.reverse()); continue; }
    itens.push({ ...item, id: `${tarefa.id}:${item.cicloChave}`, tarefaId: tarefa.id, fonte: 'TAREFA', tipo: 'tarefa', resolvido: Boolean(item.concluidaEm) });
  }
  return itens;
}

export function encontrarOcorrenciaDaTarefa(tarefa, chave) {
  const raiz = String(chave || '').split('@')[0];
  const referencia = dataAgenda(raiz.length === 7 ? `${raiz}-01` : raiz);
  const oc = expandirAgenda(tarefa.config, referencia, somarDiasAgenda(referencia, 31)).find(o => o.cicloChave === raiz);
  return oc ? itensDoCiclo(tarefa, oc).find(o => o.cicloChave === chave) : null;
}

/** Exceções movidas continuam visíveis no destino, mesmo fora do período original. */
export function ocorrenciasDaTarefa(tarefa, inicio, fim) {
  const mapa = new Map(expandirAgenda(tarefa.config, inicio, fim).map(o => [o.cicloChave, o]));
  for (const [chave, estado] of Object.entries(tarefa.estados || {})) {
    const raiz = chave.split('@')[0];
    if (!estado.alteracoes || estado.canceladaEm || mapa.has(raiz)) continue;
    const referencia = raiz.length === 7 ? `${raiz}-01` : raiz;
    const oc = expandirAgenda(tarefa.config, referencia, somarDiasAgenda(referencia, 31)).find(o => o.cicloChave === raiz);
    if (oc) mapa.set(raiz, oc);
  }
  return [...mapa.values()].flatMap(oc => itensDoCiclo(tarefa, oc)).filter(item => item.dataFim >= inicio && item.dataInicio <= fim);
}
