export function documentoValido(g) {
  return g?.status === 'PROCESSED' && Boolean(g.hash) && g.extracted?.conferenciaDocumentoPendente !== true
    && ((g.pdfBytes?.length && Buffer.from(g.pdfBytes).subarray(0, 5).toString() === '%PDF-') || Boolean(g.storageKey));
}
