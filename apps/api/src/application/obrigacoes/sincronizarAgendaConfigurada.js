import { expandirAgenda, somarDiasAgenda } from '../../../../../packages/shared/src/agenda.js';
import { calcularVencimentos } from './gerarOcorrencias.js';
import { criarConsultorDeFeriados } from './diaUtil.js';

// O chamador já segura o lock da série. Nunca recriar uma chave cancelada/concluída.
export async function sincronizarAgendaConfigurada(db, serie, { hoje, incluirVencidoDoMes = false }) {
  const existentes = await db.ocorrenciaObrigacao.findMany({ where: { obrigacaoId: serie.id } });
  const porChave = new Map(existentes.map(o => [o.cicloChave || (serie.periodicidade === 'AVULSA' ? serie.agendaConfig.dataInicio : new Date(o.dataVencimento).toISOString().slice(0, 7)), o]));
  const [empresa, feriados] = await Promise.all([
    db.portalClient.findUnique({ where: { id: serie.portalClientId }, select: { municipio: true } }),
    db.feriado.findMany({ select: { data: true, abrangencia: true, municipio: true } }),
  ]);
  const ehFeriado = criarConsultorDeFeriados(feriados, empresa?.municipio || null);
  const inicio = incluirVencidoDoMes ? new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)).toISOString().slice(0, 10) : hoje.toISOString().slice(0, 10);
  const fim = new Date(Date.UTC(hoje.getUTCFullYear() + 1, hoje.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const avulsa = serie.periodicidade === 'AVULSA';
  const previstas = expandirAgenda(serie.agendaConfig, avulsa ? serie.agendaConfig.dataInicio : inicio, avulsa ? serie.agendaConfig.dataFim : fim);
  // Um clique numa data passada é uma criação explícita; não preencher outros ciclos passados.
  if (!existentes.length && !avulsa) {
    const primeira = expandirAgenda(serie.agendaConfig, serie.agendaConfig.dataInicio, serie.agendaConfig.dataInicio)[0];
    if (primeira && !previstas.some(p => p.cicloChave === primeira.cicloChave)) previstas.unshift(primeira);
  }
  const novas = [];
  for (const p of previstas) {
    if (serie.encerradaAPartirDe && p.cicloChave >= serie.encerradaAPartirDe) continue;
    const [ano, mes] = p.dataInicio.split('-').map(Number);
    const fiscal = serie.tipo !== 'TAREFA' && ['MENSAL', 'TRIMESTRAL', 'ANUAL'].includes(serie.periodicidade)
      ? calcularVencimentos({ ...serie, periodicidade: 'MENSAL' }, { inicio: { ano, mes }, quantidadeMeses: 1 }, ehFeriado)[0] : null;
    const diariaOuSemanal = ['DIARIA','SEMANAL'].includes(serie.periodicidade);
    const deslocamento = serie.agendaConfig.vencimentoFiscal ? Math.round((+new Date(serie.agendaConfig.vencimentoFiscal)-+new Date(serie.agendaConfig.dataInicio))/86400000) : null;
    const dataVencimento = fiscal?.data || new Date(diariaOuSemanal && deslocamento !== null ? somarDiasAgenda(p.dataInicio,deslocamento) : avulsa && serie.agendaConfig.vencimentoFiscal ? serie.agendaConfig.vencimentoFiscal : p.dataFim);
    const data = { cicloChave: p.cicloChave, dataInicio: new Date(p.dataInicio), dataFim: new Date(p.dataFim), dataVencimento, competenciaRef: fiscal?.competenciaRef || null, foraDaRecorrencia: false };
    const anterior = porChave.get(p.cicloChave);
    if (!anterior) novas.push({ ...data, obrigacaoId: serie.id, status: 'PENDENTE' });
    else if (!anterior.canceladaEm && anterior.status === 'PENDENTE' && !anterior.janelaPersonalizada
      && (anterior.cicloChave !== data.cicloChave || +anterior.dataInicio !== +data.dataInicio || +anterior.dataFim !== +data.dataFim || +anterior.dataVencimento !== +data.dataVencimento || anterior.competenciaRef !== data.competenciaRef || anterior.foraDaRecorrencia)) {
      await db.ocorrenciaObrigacao.update({ where: { id: anterior.id }, data });
    }
  }
  const chaves = new Set(previstas.map(p => p.cicloChave));
  for (const o of existentes) {
    if (!o.canceladaEm && o.status === 'PENDENTE' && !o.janelaPersonalizada && new Date(o.dataInicio || o.dataVencimento) >= hoje && !chaves.has(o.cicloChave)) {
      await db.ocorrenciaObrigacao.update({ where: { id: o.id }, data: { foraDaRecorrencia: true } });
    }
  }
  const inseridas = novas.length ? await db.ocorrenciaObrigacao.createMany({ data: novas }) : { count: 0 };
  return { criadas: inseridas.count, removidas: 0 };
}
