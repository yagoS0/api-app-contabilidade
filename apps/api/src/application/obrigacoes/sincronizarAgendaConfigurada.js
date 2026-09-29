import { expandirAgenda, somarDiasAgenda, diasDaTarefa } from '../../../../../packages/shared/src/agenda.js';
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
  // A data nominal pode cair após hoje, mas a janela ajustada já estar no passado.
  // Reconciliar chaves existentes sem criar ciclos retroativos não solicitados.
  const inicioConsulta = somarDiasAgenda(avulsa ? serie.agendaConfig.dataInicio : inicio, -15);
  const previstas = expandirAgenda(serie.agendaConfig, inicioConsulta, avulsa ? serie.agendaConfig.dataFim || serie.agendaConfig.dataInicio : fim, ehFeriado)
    .filter(p => avulsa || p.dataFim >= inicio || porChave.has(p.cicloChave));
  // Um clique numa data passada é uma criação explícita; não preencher outros ciclos passados.
  if (!existentes.length && !avulsa) {
    const primeira = expandirAgenda(serie.agendaConfig, somarDiasAgenda(serie.agendaConfig.dataInicio, -15), serie.agendaConfig.dataInicio, ehFeriado)[0];
    if (primeira && !previstas.some(p => p.cicloChave === primeira.cicloChave)) previstas.unshift(primeira);
  }
  const novas = [];
  for (const p of previstas) {
    if (serie.encerradaAPartirDe && p.cicloChave >= serie.encerradaAPartirDe) continue;
    const inicioNominal = p.dataInicioOriginal || p.dataInicio;
    const [ano, mes] = inicioNominal.split('-').map(Number);
    const fiscal = serie.tipo !== 'TAREFA' && ['MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'].includes(serie.periodicidade)
      ? calcularVencimentos({ ...serie, periodicidade: 'MENSAL' }, { inicio: { ano, mes }, quantidadeMeses: 1 }, ehFeriado)[0] : null;
    const diariaOuSemanal = ['DIARIA','SEMANAL'].includes(serie.periodicidade);
    const deslocamento = serie.agendaConfig.vencimentoFiscal ? Math.round((+new Date(serie.agendaConfig.vencimentoFiscal)-+new Date(serie.agendaConfig.dataInicio))/86400000) : null;
    // A chave legada (obrigacaoId, dataVencimento) permanece nominal também nas
    // tarefas: sexta, sábado e domingo podem compartilhar a janela ajustada.
    const fimDoPrazo = p.dataFimOriginal || p.dataFim;
    const dataVencimento = fiscal?.data || new Date(diariaOuSemanal && deslocamento !== null ? somarDiasAgenda(inicioNominal,deslocamento) : avulsa && serie.agendaConfig.vencimentoFiscal ? serie.agendaConfig.vencimentoFiscal : fimDoPrazo);
    const data = { cicloChave: p.cicloChave, dataInicio: new Date(p.dataInicio), dataFim: new Date(p.dataFim), dataVencimento, competenciaRef: fiscal?.competenciaRef || null, foraDaRecorrencia: false };
    const anterior = porChave.get(p.cicloChave);
    if (p.ajusteDiaUtil === 'ANTECIPAR' || anterior?.agendaConfig?.dataInicioOriginal) {
      const agendaConfig = { ...anterior?.agendaConfig };
      for (const campo of ['dataInicioOriginal', 'dataFimOriginal', 'diasAgendados']) delete agendaConfig[campo];
      if (p.ajusteDiaUtil === 'ANTECIPAR') Object.assign(agendaConfig, {
        dataInicioOriginal: inicioNominal, dataFimOriginal: p.dataFimOriginal || p.dataFim,
        ...(p.horaInicio ? { diasAgendados: diasDaTarefa(p, ehFeriado).map(d => ({ dataInicio: d.dataInicio, dataFim: d.dataFim, dataInicioOriginal: d.dataInicioOriginal || d.dataInicio })) } : {}),
      });
      data.agendaConfig = agendaConfig;
    }
    if (!anterior) novas.push({ ...data, obrigacaoId: serie.id, status: 'PENDENTE' });
    else if (!anterior.canceladaEm && anterior.status === 'PENDENTE' && !anterior.janelaPersonalizada
      && (anterior.cicloChave !== data.cicloChave || +anterior.dataInicio !== +data.dataInicio || +anterior.dataFim !== +data.dataFim || +anterior.dataVencimento !== +data.dataVencimento || anterior.competenciaRef !== data.competenciaRef || anterior.foraDaRecorrencia || (data.agendaConfig && JSON.stringify(anterior.agendaConfig) !== JSON.stringify(data.agendaConfig)))) {
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
