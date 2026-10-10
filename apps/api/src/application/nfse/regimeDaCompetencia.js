// Usa períodos declarados pelo escritório; nunca fabrica vigência para o cadastro atual.
export function diaFiscal(valor) {
  const s = valor instanceof Date && !Number.isNaN(valor.getTime()) ? valor.toISOString().slice(0, 10) : String(valor ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

export function regimeDaCompetencia({ historico, competencia }) {
  const falha = (codigo, message) => ({ ok: false, codigo, message, correcao: 'Confira o histórico de regime e as datas no cadastro da empresa antes de emitir.' });
  const mes = typeof competencia === 'string' && /^\d{4}-\d{2}$/.test(competencia);
  const inicio = diaFiscal(mes ? `${competencia}-01` : competencia);
  if (!inicio) return falha('NFSE_REGIME_COMPETENCIA_INVALIDA', 'Informe uma competência válida para resolver o regime.');
  const fim = mes ? new Date(Date.UTC(Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7)), 0)).toISOString().slice(0, 10) : inicio;
  if (historico != null && !Array.isArray(historico)) return falha('NFSE_REGIME_HISTORICO_INVALIDO', 'O histórico tem formato inválido.');
  const periodos = (historico || []).map(r => ({ ...r, inicio: diaFiscal(r?.vigenciaInicio), fim: r?.vigenciaFim == null ? '9999-12-31' : diaFiscal(r.vigenciaFim) }));
  if (periodos.some(r => !r.inicio || !r.fim || r.fim < r.inicio)) return falha('NFSE_REGIME_HISTORICO_INVALIDO', 'O histórico contém período inválido.');
  const encontrados = periodos.filter(r => r.inicio <= fim && r.fim >= inicio);
  if (encontrados.length > 1) return falha('NFSE_REGIME_HISTORICO_AMBIGUO', 'Há mais de um período de regime na competência. Confira as vigências ou informe o dia da prestação.');
  const r = encontrados[0];
  if (!r || r.inicio > inicio || r.fim < fim) return falha('NFSE_REGIME_SEM_VIGENCIA', 'Não há regime confirmado para toda a competência informada. O regime atual não comprova o regime desse período.');
  const apuracaoIbsCbs = r.apuracaoIbsCbs || null;
  if (apuracaoIbsCbs && (!['NO_DAS', 'REGULAR'].includes(apuracaoIbsCbs) || r.regime !== 'SIMPLES' || r.inicio < '2027-01-01' || (apuracaoIbsCbs === 'REGULAR' && !String(r.comprovanteOpcaoIbsCbs || '').trim()))) return falha('NFSE_IBSCBS_OPCAO_INVALIDA', 'Confira a opção de IBS/CBS, a vigência e a referência do comprovante no histórico.');
  return { ok: true, apuracaoIbsCbs, regime: r.regime, fonte: 'REGIME_HISTORICO', periodoId: r.id || null,
    vigenciaInicio: r.inicio, vigenciaFim: r.vigenciaFim == null ? null : r.fim, competenciaInicio: inicio, competenciaFim: fim };
}
