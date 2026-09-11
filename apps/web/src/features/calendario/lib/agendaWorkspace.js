import { somarDiasAgenda } from '../../../../../../packages/shared/src/agenda.js';
export const CORES_PRIORIDADE = { '': 'var(--text-muted)', BAIXA: '#e9bb42', MEDIA: '#ef934c', ALTA: '#b58aef', URGENTE: '#ee737f' };
export const COR_OBRIGACAO = '#1351b4';
export const corAtividade = item => item.tipo === 'obrigacao' ? COR_OBRIGACAO : CORES_PRIORIDADE[item.prioridade || ''];
export const RECORRENCIAS = { AVULSA: 'Não repetir', DIARIA: 'Todos os dias', SEMANAL: 'Toda semana', MENSAL: 'Todo mês', TRIMESTRAL: 'A cada 3 meses', ANUAL: 'Todo ano' };
export const dataLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const dataBR = d => d ? d.slice(0, 10).split('-').reverse().join('/') : '';
export const dataExtenso = d => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
export function diasDoPeriodo(referencia, visao) {
  const d = new Date(`${referencia}T12:00:00Z`);
  let inicio = referencia, tamanho = 1;
  if (visao === 'mes' || visao === 'lista') { inicio = `${referencia.slice(0,7)}-01`; tamanho = 42; }
  if (visao !== 'dia') {
    const semana = new Date(`${inicio}T12:00:00Z`).getUTCDay();
    inicio = somarDiasAgenda(inicio, -((semana + 6) % 7));
    if (visao === 'semana') tamanho = 7;
  }
  return Array.from({ length: tamanho }, (_, i) => somarDiasAgenda(inicio, i));
}
export function itensDasObrigacoes(obrigacoes) {
  return obrigacoes.flatMap(o => o.ocorrencias.map(oc => ({
    ...o.agendaConfig, ...oc, id: oc.ocorrenciaId, ocorrenciaId: oc.ocorrenciaId,
    fonte: 'OBRIGACAO', tipo: o.tipo === 'TAREFA' ? 'tarefa' : 'obrigacao',
    obrigacaoId: o.obrigacaoId, regraId: o.regraId, titulo: o.nome, descricao: o.descricao,
    companyId: o.companyId, empresa: o.empresa, cnpj: o.cnpj, resolvido: oc.situacao === 'CONCLUIDA',
    conclusaoAutomatica: o.conclusaoAutomatica, prioridade: o.agendaConfig?.prioridade || '', ...oc.agendaConfig,
  })));
}
export function agruparAtividades(itens) {
  const grupos = new Map();
  for (const i of itens) {
    const chave = i.tipo === 'obrigacao' && i.regraId
      ? `${i.regraId}|${i.cicloChave}|${i.dataInicio}|${i.dataFim}|${i.horaInicio || ''}|${i.horaFim || ''}|${i.prioridade || ''}|${i.titulo}`
      : `${i.tipo}|${i.id}`;
    if (!grupos.has(chave)) grupos.set(chave, { ...i, id: chave, itens: [] });
    grupos.get(chave).itens.push(i);
  }
  return [...grupos.values()].map(g => ({ ...g, resolvido: g.itens.every(i => i.resolvido) }));
}
/** Blocos diários representam a mesma ocorrência por empresa e preservam sua janela de edição. */
export function blocosDiarios(atividades, inicio, fim) {
  return atividades.flatMap(item => {
    if (!item.horaInicio || item.dataInicio === item.dataFim) return [item];
    const blocos = [];
    for (let dia = item.dataInicio < inicio ? inicio : item.dataInicio; dia <= item.dataFim && dia <= fim; dia = somarDiasAgenda(dia, 1)) {
      blocos.push({ ...item, id: `${item.id}@${dia}`, dataInicio: dia, dataFim: dia, atividadeOriginal: item });
    }
    return blocos;
  });
}
export function faixasDoPeriodo(itens, dias) {
  const ocupacao = [];
  return itens.filter(i => i.dataFim >= dias[0] && i.dataInicio <= dias.at(-1))
    .sort((a,b) => a.dataInicio.localeCompare(b.dataInicio) || b.dataFim.localeCompare(a.dataFim) || a.id.localeCompare(b.id))
    .map(item => {
      const inicio = Math.max(0, dias.findIndex(d => d >= item.dataInicio));
      const fim = item.dataFim >= dias.at(-1) ? dias.length - 1 : dias.indexOf(item.dataFim);
      let linha = ocupacao.findIndex(ate => ate < inicio);
      if (linha === -1) linha = ocupacao.length;
      ocupacao[linha] = fim;
      return { item, inicio, fim, linha };
    });
}
export const minutos = hora => hora.split(':').reduce((h, m) => Number(h) * 60 + Number(m));
// Horário fixo reserva somente espaço visual para leitura; não cria duração persistida.
export const fimVisual = item => item.horaFim ? minutos(item.horaFim) : Math.min(1440, minutos(item.horaInicio) + 30);
export const horarioAtividade = item => item.horaInicio ? item.horaFim ? `${item.horaInicio}–${item.horaFim}` : item.horaInicio : '';
/** Eventos simultâneos recebem colunas próprias, sem encobrir os anteriores. */
export function posicionarHorarios(itens) {
  const ordenados = [...itens].sort((a,b) => minutos(a.horaInicio) - minutos(b.horaInicio) || a.id.localeCompare(b.id));
  const blocos = []; let bloco = [], ate = -1;
  for (const item of ordenados) {
    if (minutos(item.horaInicio) >= ate && bloco.length) { blocos.push(bloco); bloco = []; ate = -1; }
    bloco.push(item); ate = Math.max(ate, fimVisual(item));
  }
  if (bloco.length) blocos.push(bloco);
  return blocos.flatMap(b => {
    const finais = [];
    const pos = b.map(item => { let coluna = finais.findIndex(f => f <= minutos(item.horaInicio)); if (coluna < 0) coluna = finais.length; finais[coluna] = fimVisual(item); return { item, coluna }; });
    return pos.map(p => ({ ...p, colunas: finais.length }));
  });
}
