// Evidência local por competência. Guia sem PDF não encerra a captura.
export function documentosPgdas(circular, guide) {
  const declaracao = Boolean(circular?.pgdasNumeroDeclaracao);
  const extrato = declaracao && Boolean(circular?.pgdasDeclaracaoFileId && circular?.pgdasReciboFileId);
  const semDas = extrato && circular?.dasTotal != null && Number(circular.dasTotal) === 0 && !circular.dasNumeroDocumento;
  return { declaracao, extrato, das: Boolean(guide?.pdfBytes?.length) || semDas };
}

export function procuracaoPermitePgdas(procuracao) {
  return procuracao?.status === "ATIVA" && (procuracao.systems || []).some((s) => {
    const nome = String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    return nome.trim() === "TODOS" || /\b0*146\b/.test(nome) || /PGDAS[ -]?D/.test(nome);
  });
}

// A origem não determina a disponibilidade: uploads processados também encerram a captura.
// NULL em sourceFileId é comum em uploads; incluí-lo explicitamente evita o NOT SQL excluí-lo.
export function whereDasSalvo(portalClientId, competencia) {
  return {
    portalClientId, competencia, tipo: "SIMPLES", status: "PROCESSED", parcelamentoId: null,
    OR: [{ sourceFileId: null }, { NOT: { sourceFileId: { startsWith: "PARC-" } } }],
    AND: [{ pdfBytes: { not: null } }, { NOT: { pdfBytes: Buffer.alloc(0) } }],
  };
}
