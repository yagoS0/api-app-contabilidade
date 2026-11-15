const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v) ? v.toLowerCase() : null;
export function confirmacaoDoEscopo448(row, { companyId, competencia }) {
  const v = row.value;
  return Boolean(v && id(v.id) && id(v.guideId) && v.companyId === companyId
    && v.documento?.competencia === competencia
    && row.key === `contabil:cliente:confirmacao:${companyId}:${v.id}`);
}
export function projetarConfirmacaoHistorica448(row, guia) {
  const v = row.value;
  const anterior = hash(v.documento?.hash); const atual = hash(guia?.hash);
  return { id: v.id, guideId: v.guideId, guiaLocalizada: Boolean(guia),
    competenciaAtualCompativel: guia ? guia.competencia === v.documento.competencia : null,
    hashDocumentalRegistrado: anterior, hashDocumentalAtual: atual,
    hashDocumentalCoincidente: anterior && atual ? anterior === atual : null,
    confirmacaoSubstituida: v.estadoBaixa === 'SUBSTITUIDA' || id(v.substituidaPor),
    fato: 'CONFIRMACAO_LOCAL_NAO_COMPROVA_BAIXA_NEM_REMOCAO' };
}
