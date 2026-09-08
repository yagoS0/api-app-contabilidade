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
