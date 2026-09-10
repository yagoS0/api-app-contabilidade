// Ciclo é o mês âncora, antes de ajustar prazo/competência. Datas são civis UTC.
export function normalizarJanela(janela) {
  if (janela == null) return null;
  if (janela.modo !== 'DIAS_DO_CICLO') throw new Error('Escolha uma janela por dias do ciclo.');
  const inicio = Number(janela.diaInicio), fim = Number(janela.diaFim);
  const deslocamentoFim = Number(janela.deslocamentoFim || 0);
  if (![inicio, fim].every(n => Number.isInteger(n) && n >= 1 && n <= 31)
    || ![0, 1].includes(deslocamentoFim) || (!deslocamentoFim && fim < inicio)) {
    throw new Error('Informe dias entre 1 e 31; para terminar no mês seguinte, selecione essa opção.');
  }
  return { modo: 'DIAS_DO_CICLO', diaInicio: inicio, diaFim: fim, deslocamentoFim };
}
function diaCivil(ciclo, dia, deslocamento = 0) {
  const [ano, mes] = ciclo.split('-').map(Number);
  const base = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(dia, ultimo)));
}
export function aplicarJanela(previsao, janela) {
  if (!janela) return previsao;
  return { ...previsao, dataInicio: diaCivil(previsao.mesVencimento, janela.diaInicio),
    dataFim: diaCivil(previsao.mesVencimento, janela.diaFim, janela.deslocamentoFim) };
}
export function janelaDoCiclo(serie, ciclo) {
  const versoes = [...(Array.isArray(serie.agendaVersoes) ? serie.agendaVersoes : [])]
    .filter(v => v.aPartirDe <= ciclo);
  return versoes.length ? versoes[versoes.length - 1].janela : serie.janelaTrabalho;
}
export function cicloDaOcorrencia(oc, serie) {
  if (oc.cicloChave) return oc.cicloChave;
  if (oc.competenciaRef) {
    const [a, m] = oc.competenciaRef.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1 + (serie.defasagemMeses ?? 1), 1)).toISOString().slice(0, 7);
  }
  return new Date(oc.dataVencimento).toISOString().slice(0, 7);
}
export function cicloPermitido(serie, ciclo) { return !serie.encerradaAPartirDe || ciclo < serie.encerradaAPartirDe; }

// Snapshots completos da regra permitem editar o futuro sem reescrever o cadastro-base.
export function regraDoCiclo(serie, ciclo) {
  const aplicaveis = (serie.agendaVersoes || []).filter(v => v.aPartirDe <= ciclo && v.regra);
  return { ...serie, ...(aplicaveis.length ? aplicaveis[aplicaveis.length - 1].regra : {}) };
}
export function normalizarRegraRecorrente(dados, base) {
  const r = { ...base, ...dados };
  const periodicidade = String(r.periodicidade || '').toUpperCase();
  const diaVencimento = Number(r.diaVencimento), mesReferencia = Number(r.mesReferencia);
  const defasagemMeses = Number(r.defasagemMeses ?? 1), diasPreparacao = Number(r.diasPreparacao || 0);
  if (!['MENSAL', 'TRIMESTRAL', 'ANUAL'].includes(periodicidade)) throw new Error('Escolha uma frequência recorrente.');
  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) throw new Error('Informe dia de vencimento entre 1 e 31.');
  if (periodicidade !== 'MENSAL' && (!Number.isInteger(mesReferencia) || mesReferencia < 1 || mesReferencia > 12)) throw new Error('Informe o mês de referência da recorrência.');
  if (!Number.isInteger(defasagemMeses) || defasagemMeses < 0 || defasagemMeses > 12) throw new Error('Defasagem deve ser de 0 a 12 meses.');
  if (!Number.isInteger(diasPreparacao) || diasPreparacao < 0 || diasPreparacao > 365) throw new Error('Preparação deve ser de 0 a 365 dias.');
  if (!['ANTECIPAR', 'POSTERGAR', 'MANTER'].includes(r.ajusteDiaUtil)) throw new Error('Escolha o ajuste de dia útil.');
  return { periodicidade, diaVencimento, mesReferencia: periodicidade === 'MENSAL' ? null : mesReferencia, defasagemMeses, diasPreparacao, ajusteDiaUtil: r.ajusteDiaUtil };
}
