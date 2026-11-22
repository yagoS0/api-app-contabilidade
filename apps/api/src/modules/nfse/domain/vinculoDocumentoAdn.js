// Recebe identidades normalizadas pela aplicação; não infere vínculo pelo certificado.
export function avaliarVinculoDocumentoAdn({ empresa, prestador, tomador }) {
  if (!empresa || (!prestador && !tomador)) {
    const error = new Error('adn_vinculo_documental_inconclusivo');
    error.code = 'ADN_VINCULO_DOCUMENTAL_INCONCLUSIVO';
    throw error;
  }
  return { pertence: prestador === empresa || tomador === empresa,
    papel: prestador === empresa ? 'EMIT' : 'DEST', empresa, prestador, tomador };
}
