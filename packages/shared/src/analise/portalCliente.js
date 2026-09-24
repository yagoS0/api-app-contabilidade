const mesValido = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v));
export function moverMesPortal(mes, deslocamento) {
  const [ano, numero] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano, numero - 1 + deslocamento, 1)).toISOString().slice(0, 7);
}
export function disponibilidadeRelatorios(competenciasFechadas, referencia) {
  if (!mesValido(referencia)) throw new Error('PERIODO_INVALIDO');
  const fechados = [...new Set(competenciasFechadas.filter(mesValido))].sort();
  const obrigatorios = [-3, -2, -1].map(n => moverMesPortal(referencia, n));
  const pendentes = obrigatorios.filter(m => !fechados.includes(m));
  return { liberado: !pendentes.length, referencia, pendentes,
    de: moverMesPortal(referencia, -12), ate: moverMesPortal(referencia, -1),
    competenciasFechadas: fechados.filter(m => m >= moverMesPortal(referencia, -12) && m < referencia) };
}
export function validarPeriodoPortal({ de, ate, comparar = 'anterior' }, acesso) {
  if (!mesValido(de) || !mesValido(ate) || de > ate || de < acesso.de || ate > acesso.ate || !['anterior', 'ano'].includes(comparar)) throw new Error('PERIODO_INVALIDO');
  const meses = acesso.competenciasFechadas.filter(m => m >= de && m <= ate).sort();
  if (!meses.length) throw new Error('SEM_MESES_FECHADOS');
  return { de: meses[0], ate: meses.at(-1), comparar };
}
// Mesma base da DRE, com grupos disjuntos: tributos e folha não são descontados duas vezes.
export function cardsContabeis(dre) {
  const vazio = { entradas: null, saidas: null, folha: null, impostos: null, resultado: null };
  if (!dre || dre.semLancamento) return vazio;
  const linhas = Object.fromEntries(dre.linhas.map(l => [l.chave, l.valor]));
  const soma = chaves => chaves.some(k => linhas[k] == null || !Number.isFinite(Number(linhas[k]))) ? null : chaves.reduce((s,k) => s + Math.round(Number(linhas[k])*100), 0)/100;
  const negativo = chaves => { const v = soma(chaves); return v == null ? null : -v; };
  return { entradas: soma(['receitaBruta','receitasFinanceiras','outrasReceitas']),
    saidas: negativo(['custos','gerais','depreciacao','despesasFinanceiras']),
    folha: negativo(['pessoal']), impostos: negativo(['deducoes','tributarias','irpjCsll']),
    resultado: linhas.resultadoDoPeriodo ?? null };
}
