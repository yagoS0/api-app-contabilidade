// Receiving documents is not evidence of a search. This projection never fetches.
export function resumoCapturaNotas({ tipo = 'NFSE', adnState, dfeState, loading, error, agora = Date.now() }) {
  const especie = tipo === 'NFE' ? 'NF-e' : 'NFS-e';
  const state = tipo === 'NFE' ? dfeState : adnState;
  if (loading) return { texto: 'Captura ' + especie + ': carregando…' };
  if (error || !state) return { texto: 'Captura ' + especie + ': indisponível' };
  const tentativa = tipo === 'NFE' ? (state.dfeLastAttemptAt ?? state.ultimaConsultaEm) : state.adnLastAttemptAt;
  const erro = tipo === 'NFE' ? state.dfeLastError : state.adnLastError;
  const civil = typeof tentativa === 'string' ? tentativa.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/) : null;
  const civilValida = civil && new Date(Date.UTC(Number(civil[1]), Number(civil[2]) - 1, Number(civil[3]))).toISOString().slice(0, 10) === civil[0].slice(0, 10);
  const instante = tentativa instanceof Date || civilValida ? new Date(tentativa).getTime() : NaN;
  const data = !tentativa ? 'sem tentativa registrada'
    : !Number.isFinite(instante) || instante > agora ? 'data da tentativa a verificar'
      : new Date(instante).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  return { texto: 'Última busca ' + especie + ': ' + data + (erro ? ' · tentativa com erro' : '') };
}
