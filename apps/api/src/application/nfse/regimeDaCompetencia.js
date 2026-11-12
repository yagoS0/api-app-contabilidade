// Usa períodos declarados pelo escritório; nunca fabrica vigência para o cadastro atual.
export function diaFiscal(valor) {
  const s = valor instanceof Date && !Number.isNaN(valor.getTime()) ? valor.toISOString().slice(0, 10) : String(valor ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

// Somente a competência da nota admite Date serializado pelo JSON do lote.
// Não ampliar diaFiscal: consumidores e vigências usam seu contrato estrito.
function diaDaCompetencia(valor) {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(valor)) {
    const instante = new Date(valor);
    // O round-trip rejeita dias impossíveis e 24:00, normalizados por Date.
    if (Number.isNaN(instante.getTime()) || instante.toISOString() !== valor) return null;
    return diaFiscal(valor.slice(0, 10));
  }
  return diaFiscal(valor);
}

export function regimeDaCompetencia({ historico, competencia }) {
  const falha = (codigo, message, correcao = 'Peça ao contador para conferir as vigências comprovadas no Histórico de regime da empresa.') => ({ ok: false, codigo, message, correcao });
  const mes = typeof competencia === 'string' && /^\d{4}-\d{2}$/.test(competencia);
  const inicio = diaDaCompetencia(mes ? `${competencia}-01` : competencia);
  if (!inicio) return falha('NFSE_REGIME_COMPETENCIA_INVALIDA', 'A competência da nota é inválida.', 'Confira a data da prestação ou o mês informado na nota.');
  const fim = mes ? new Date(Date.UTC(Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7)), 0)).toISOString().slice(0, 10) : inicio;
  if (historico != null && !Array.isArray(historico)) return falha('NFSE_REGIME_HISTORICO_INVALIDO', 'O histórico tem formato inválido.');
  const periodos = (historico || []).map(r => ({ ...r, inicio: diaFiscal(r?.vigenciaInicio), fim: r?.vigenciaFim == null ? '9999-12-31' : diaFiscal(r.vigenciaFim) }));
  if (periodos.some(r => !r.inicio || !r.fim || r.fim < r.inicio)) return falha('NFSE_REGIME_HISTORICO_INVALIDO', 'O histórico contém período inválido.');
  const encontrados = periodos.filter(r => r.inicio <= fim && r.fim >= inicio);
  const referencia = mes ? competencia.slice(5) + '/' + competencia.slice(0, 4) : inicio.split('-').reverse().join('/');
  if (encontrados.length > 1) return falha('NFSE_REGIME_HISTORICO_AMBIGUO', mes
    ? `Há mais de um período de regime em ${referencia}. Confira as vigências e informe o dia efetivo da prestação.`
    : `Há períodos de regime sobrepostos em ${referencia}. Confira as datas no histórico.`);
  const r = encontrados[0];
  if (!r || r.inicio > inicio || r.fim < fim) {
    let situacao = 'A competência está entre vigências cadastradas.';
    if (!periodos.length) situacao = 'O histórico de regime da empresa está vazio.';
    else if (r) situacao = 'A vigência cadastrada cobre apenas parte do mês. Se souber o dia efetivo da prestação, informe-o na nota.';
    else if (periodos.every(p => p.fim < inicio)) situacao = 'Todas as vigências cadastradas já terminaram.';
    else if (periodos.every(p => p.inicio > fim)) situacao = 'Todas as vigências cadastradas começam depois dessa competência.';
    return falha('NFSE_REGIME_SEM_VIGENCIA', `Não há regime confirmado para ${referencia}. ${situacao}`);
  }
  const apuracaoIbsCbs = r.apuracaoIbsCbs || null;
  if (apuracaoIbsCbs && (!['NO_DAS', 'REGULAR'].includes(apuracaoIbsCbs) || r.regime !== 'SIMPLES' || r.inicio < '2027-01-01' || (apuracaoIbsCbs === 'REGULAR' && !String(r.comprovanteOpcaoIbsCbs || '').trim()))) return falha('NFSE_IBSCBS_OPCAO_INVALIDA', 'Confira a opção de IBS/CBS, a vigência e a referência do comprovante no histórico.');
  return { ok: true, apuracaoIbsCbs, regime: r.regime, fonte: 'REGIME_HISTORICO', periodoId: r.id || null,
    vigenciaInicio: r.inicio, vigenciaFim: r.vigenciaFim == null ? null : r.fim, competenciaInicio: inicio, competenciaFim: fim };
}
