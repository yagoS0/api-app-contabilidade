// IDs do menu carregam a seleção que os originou. O core ainda revalida vínculo e permissões.
const PREFIXO = 'altan.ctx.v1:';
export function vincularOpcoesAoContexto(opcoes, contexto) {
  if (!contexto?.atendimentoId || !contexto?.portalClientId || !Number.isSafeInteger(contexto.versao)) return opcoes;
  return opcoes.map(o => String(o.id).startsWith('altan.client.') ? { ...o,
    id: `${PREFIXO}${contexto.atendimentoId}:${contexto.versao}:${contexto.portalClientId}:${o.id}` } : o);
}
export function lerContextoDoMenu(id) {
  if (!String(id || '').startsWith(PREFIXO)) return null;
  const partes = id.slice(PREFIXO.length).split(':');
  const [atendimentoId, versao, portalClientId, acaoId] = partes;
  if (partes.length !== 4 || !atendimentoId || !portalClientId || !/^\d+$/.test(versao)
    || !Number.isSafeInteger(Number(versao)) || !acaoId?.startsWith('altan.client.')) return { invalido: true };
  return { atendimentoId, versao: Number(versao), portalClientId, acaoId };
}
