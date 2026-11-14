export const STATUS_DOCUMENTO = 'DOCUMENTO_NAO_ARRECADATORIO';
export const PREFIXO_DOCUMENTO = 'guia-documento:';
export const documentoNaoArrecadatorio = guia => guia?.status === STATUS_DOCUMENTO || Boolean(guia?.extracted?.documentoNaoArrecadatorio);
export function exigirGuiaArrecadatoria(guia) {
  if (documentoNaoArrecadatorio(guia)) throw Object.assign(new Error('Documento reclassificado. Consulte Documentos da empresa; ações tributárias estão bloqueadas.'), { code: STATUS_DOCUMENTO, status: 409 });
}
