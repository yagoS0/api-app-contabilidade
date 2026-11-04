import { isGuiaDeParcelamento } from './guideContract.js';
import { CODIGOS_RECEITA_NAO_PREVIDENCIARIOS, composicaoSomentePrevidenciaria } from '../fiscal/serpro/parseArrecadacao.js';
const direct = new Set(['SIMPLES', 'INSS', 'FGTS', 'PIS', 'COFINS', 'ISS', 'IRPJ', 'CSLL']);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// Resolves document composition only, never tax applicability or provider capability.
export function resolverTributosDaGuia(guide) {
  const unknown = [];
  if (!plain(guide)) return { status: 'UNKNOWN', tributos: [], components: [], unknown: [{ reason: 'DOCUMENTO_INVALIDO' }] };
  const id = guide.guideId || guide.id || null;
  const companyId = guide.companyId || guide.portalClientId || null;
  const parcelamento = isGuiaDeParcelamento(guide);
  const composition = guide.extracted?.composicao;
  const components = [];
  if (composition != null && !Array.isArray(composition)) unknown.push({ reason: 'COMPOSICAO_INVALIDA' });
  else for (const [index, item] of (composition || []).entries()) {
    if (!plain(item)) { unknown.push({ index, reason: 'ITEM_INVALIDO' }); continue; }
    // Do not strip arbitrary characters or silently map unknown codes from a label.
    const rawCode = item.codigo == null ? '' : String(item.codigo);
    const match = /^(\d{4})(?:-\d{2})?$/.exec(rawCode);
    const code = match?.[1];
    const byCode = code ? CODIGOS_RECEITA_NAO_PREVIDENCIARIOS[code]
      || (composicaoSomentePrevidenciaria([{ codigo: code }]) ? 'INSS' : null) : null;
    const declared = direct.has(item.tributo) ? item.tributo : null;
    const tributo = rawCode ? byCode : declared;
    if (!tributo || (item.tributo != null && !declared) || (byCode && declared && byCode !== declared)) {
      unknown.push({ index, codigo: item.codigo ?? null, tributo: item.tributo ?? null, reason: byCode && declared ? 'CODIGO_TRIBUTO_DIVERGENTES' : 'COMPONENTE_DESCONHECIDO' });
    } else components.push({ index, tributo, codigo: item.codigo ?? null });
  }
  const tributos = [...new Set(components.map(c => c.tributo))];
  if (!composition?.length && !unknown.length && !parcelamento) {
    if (direct.has(guide.tipo)) tributos.push(guide.tipo);
    else unknown.push({ reason: 'SEM_COMPOSICAO_IDENTIFICADA' });
  }
  // A real installment keeps its policy identity, never becomes the monthly DAS.
  if (guide.parcelamentoAvulso === true && !parcelamento) unknown.push({ reason: 'PARCELAMENTO_SEM_VINCULO' });
  if (!id || !companyId) unknown.push({ reason: 'IDENTIDADE_INCOMPLETA' });
  return { guideId: id, companyId, competencia: guide.competencia ?? null,
    status: unknown.length ? 'UNKNOWN' : 'IDENTIFIED',
    tributos: parcelamento ? ['PARCELAMENTO'] : tributos, components, unknown,
    parcelamentoId: guide.parcelamentoId ?? null, numeroParcela: guide.numeroParcela ?? null };
}
