// Recebe identidade e interpretação já preparadas pela captura. As capacidades
// de Guias conservam a consulta e o funil de escrita legados, sem nova política.
export async function persistirDocumentoDas({
  existingGuideId,
  portalClient,
  mapped,
  sourceFileId,
  labels,
  normalizedCompetencia,
  emailStatusOverride,
  resolvedServiceId,
  procuradorCnpj,
}, { lerGuiaPorSourceFileId, createOrUpdateGuideFromProcessing, hashPdf, clock }) {
  const existingGuide = await lerGuiaPorSourceFileId(sourceFileId);
  const now = clock();

  // Preservar paymentStatus existente: emitir guia no SERPRO não confirma pagamento
  const preservedPayment = existingGuide
    ? {
        paymentStatus: existingGuide.paymentStatus,
        paymentStatusSource: existingGuide.paymentStatusSource,
        paymentConfirmedAt: existingGuide.paymentConfirmedAt,
      }
    : { paymentStatus: "OPEN" };

  const guide = await createOrUpdateGuideFromProcessing({
    existingGuideId: existingGuideId || existingGuide?.id || null,
    portalClientId: portalClient.id,
    legacyCompanyId: portalClient.companyId || null,
    parsed: mapped.parsed,
    source: "SERPRO",
    sourceFileId,
    sourcePath: `${labels.sourcePath} ${normalizedCompetencia}`,
    driveInboxFolderId: null,
    driveFinalFolderId: null,
    driveFinalFileId: null,
    pdfBytes: mapped.pdfBuffer,
    hash: hashPdf(mapped.pdfBuffer),
    status: "PROCESSED",
    errors: [],
    ...preservedPayment,
    emailStatusOverride,
    serproLastCheckedAt: now,
    serproLastCheckResult: labels.checkResult,
    serproLastSeenAt: now,
    serproService: resolvedServiceId,
    extracted: {
      integrationSource: "SERPRO_PGDASD",
      sistema: "PGDASD",
      servico: resolvedServiceId,
      numeroDocumento: mapped.numeroDocumento,
      contratanteCnpj: procuradorCnpj,
      contribuinteCnpj: portalClient.cnpj,
      referencia: normalizedCompetencia,
      rawPayload: mapped.rawPayload,
    },
  });

  return { guide, now };
}
