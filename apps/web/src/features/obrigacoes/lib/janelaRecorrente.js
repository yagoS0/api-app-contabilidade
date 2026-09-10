// Prévia civil e mock; o servidor valida novamente antes de persistir.
export function janelaRecorrente(ciclo, janela) {
  if (!janela) return null;
  const { diaInicio, diaFim } = janela;
  const deslocamento = Number(janela.deslocamentoFim || 0);
  if (janela.modo !== 'DIAS_DO_CICLO' || ![diaInicio, diaFim].every(n => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 31)
    || ![0, 1].includes(deslocamento) || (!deslocamento && Number(diaFim) < Number(diaInicio))) throw new Error('Informe uma janela válida; fim no mês seguinte deve ser explícito.');
  const [ano, mes] = ciclo.split('-').map(Number);
  const dia = (n, offset) => {
    const base = new Date(Date.UTC(ano, mes - 1 + offset, 1));
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(Number(n), new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
  };
  return { dataInicio: dia(diaInicio, 0), dataFim: dia(diaFim, deslocamento) };
}
export function cicloRecorrente(oc, serie) {
  if (oc.cicloChave) return oc.cicloChave;
  if (!oc.competenciaRef) return oc.dataVencimento.slice(0, 7);
  const [a, m] = oc.competenciaRef.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + Number(serie.defasagemMeses ?? 1), 1)).toISOString().slice(0, 7);
}
