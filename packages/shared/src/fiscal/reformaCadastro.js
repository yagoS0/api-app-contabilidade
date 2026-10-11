// Contrato do cadastro conferido pelo escritório; não efetua opção nos portais fiscais.
export const REGIMES_REFORMA = { SIMPLES: 'Simples Nacional', LUCRO_PRESUMIDO: 'Lucro Presumido', LUCRO_REAL: 'Lucro Real', MEI: 'MEI', OUTRO: 'Outro / conferir' };
export const FORMAS_IBSCBS = { DAS: 'IBS/CBS no DAS', REGULAR: 'IBS/CBS no regime regular', PENDENTE: 'A definir', NAO_APLICAVEL: 'Não aplicável neste período' };
export const SITUACOES_REFORMA = { EM_ESTUDO: 'Em estudo', SOLICITADA: 'Opção solicitada', CONFIRMADA: 'Enquadramento confirmado' };
export const EMISSOR_REFORMA = { NAO_VERIFICADO: 'Emissor não verificado', EM_AJUSTE: 'Emissor em ajuste', VALIDADO: 'Emissor conferido pelo escritório' };
export function diaValido(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const falha = texto => { const e = new Error(texto); e.status = 400; throw e; };
const texto = (v, max = 1500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function validarCadastroReforma(entrada) {
  if (!entrada || !Array.isArray(entrada.periodos) || entrada.periodos.length > 80) falha('Informe até 80 períodos de enquadramento.');
  const periodos = entrada.periodos.map(p => {
    if (!p || !diaValido(p.inicio) || (p.fim && !diaValido(p.fim))) falha('Informe datas válidas para a vigência.');
    if (p.fim && p.fim < p.inicio) falha('O fim da vigência deve ser igual ou posterior ao início.');
    if (!Object.hasOwn(REGIMES_REFORMA, p.regime) || !Object.hasOwn(FORMAS_IBSCBS, p.forma) || !Object.hasOwn(SITUACOES_REFORMA, p.situacao)) falha('Confira regime, forma de apuração e situação.');
    if (p.forma === 'DAS' && p.regime !== 'SIMPLES') falha('A opção IBS/CBS no DAS deste cadastro é exclusiva do Simples Nacional.');
    if (p.regime === 'MEI' && !['PENDENTE', 'NAO_APLICAVEL'].includes(p.forma)) falha('MEI exige tratamento próprio; não use a opção do Simples ME/EPP.');
    if (p.regime === 'SIMPLES' && ['DAS', 'REGULAR'].includes(p.forma) && p.inicio < '2027-01-01') falha('Registre a escolha de IBS/CBS do Simples com vigência a partir de 2027.');
    if (p.regime === 'SIMPLES' && p.forma === 'NAO_APLICAVEL' && (!p.fim || p.fim >= '2027-01-01')) falha('Para o Simples a partir de 2027, registre a forma de apuração ou mantenha a decisão a definir.');
    if (p.situacao === 'CONFIRMADA' && (p.forma === 'PENDENTE' || p.regime === 'OUTRO')) falha('Resolva o enquadramento antes de marcá-lo como confirmado.');
    const evidencia = texto(p.evidencia);
    if (p.situacao !== 'EM_ESTUDO' && !evidencia) falha('Informe o protocolo ou a referência do documento que comprova a situação.');
    return { inicio: p.inicio, fim: p.fim || null, regime: p.regime, forma: p.forma, situacao: p.situacao, evidencia };
  }).sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (let i = 1; i < periodos.length; i++) if (!periodos[i - 1].fim || periodos[i].inicio <= periodos[i - 1].fim) falha('Há vigências sobrepostas. Encerre o período anterior antes de iniciar o seguinte.');
  const emissor = entrada.emissor || 'NAO_VERIFICADO';
  if (!Object.hasOwn(EMISSOR_REFORMA, emissor)) falha('Situação do emissor inválida.');
  const evidenciaEmissor = texto(entrada.evidenciaEmissor);
  if (emissor === 'VALIDADO' && !evidenciaEmissor) falha('Registre a evidência da conferência do emissor.');
  const motivo = texto(entrada.motivo);
  if (!motivo) falha('Descreva o motivo desta revisão.');
  return { periodos, emissor, evidenciaEmissor, motivo };
}
export const cadastroReformaVazio = () => ({ periodos: [], emissor: 'NAO_VERIFICADO', evidenciaEmissor: '', motivo: '' });
export function periodoNaData(dados, dia) {
  if (!diaValido(dia)) return null;
  return dados?.periodos?.find(p => p.inicio <= dia && (!p.fim || p.fim >= dia)) || null;
}
export function resumirCadastroReforma(dados, dia) {
  const periodo = periodoNaData(dados, dia);
  return { periodo, situacao: periodo?.situacao || 'SEM_CADASTRO', emissor: dados?.emissor || 'NAO_VERIFICADO',
    pendente: !periodo || periodo.situacao !== 'CONFIRMADA' || dados?.emissor !== 'VALIDADO' };
}
