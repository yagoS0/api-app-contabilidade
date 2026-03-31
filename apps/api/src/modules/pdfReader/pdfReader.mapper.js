/**
 * Map pdf-reader POST /extract JSON to the shape expected by GuideParserClient.normalizeParserPayload.
 * @param {Record<string, unknown>} raw
 */
export function mapPdfReaderToParserShape(raw) {
  const fields = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
  const rawText = raw.raw_text != null ? String(raw.raw_text) : "";
  return {
    tipo: raw.document_type != null ? String(raw.document_type) : null,
    cnpj: fields.cnpj != null ? String(fields.cnpj) : null,
    razaoSocial: fields.razao_social != null ? String(fields.razao_social) : null,
    competencia: fields.competencia != null ? String(fields.competencia) : null,
    vencimento: fields.vencimento != null ? String(fields.vencimento) : null,
    valor: fields.valor_total,
    codigoReceita:
      fields.codigo_receita != null ? String(fields.codigo_receita) : null,
    barcode: fields.codigo_barras != null ? String(fields.codigo_barras) : null,
    confidence: raw.confidence,
    rawTextSample: rawText ? rawText.slice(0, 2000) : null,
    fields: {
      inssProLabore: Boolean(fields.inss_pro_labore),
      subtipo: fields.subtipo != null ? String(fields.subtipo) : null,
    },
  };
}
