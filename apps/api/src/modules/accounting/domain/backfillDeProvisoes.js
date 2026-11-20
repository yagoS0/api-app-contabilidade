export const TIPOS_BACKFILL = Object.freeze(['DARF', 'PIS', 'COFINS', 'IRPJ', 'CSLL', 'ISS']);
export const competenciaValida = value => typeof value === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);

export function motivoImpedimentoBackfill(guia, selecionada) {
  if (!guia || guia.id !== selecionada.id || guia.portalClientId !== selecionada.portalClientId || guia.competencia !== selecionada.competencia) return 'GUIA_ALTERADA';
  if (new Date(guia.updatedAt).getTime() !== new Date(selecionada.updatedAt).getTime()) return 'GUIA_ALTERADA';
  if (!guia.portalClientId || !competenciaValida(guia.competencia) || guia.status !== 'PROCESSED' || !TIPOS_BACKFILL.includes(guia.tipo) || guia.parcelamentoId) return 'GUIA_INELEGIVEL';
  if (guia.accountingEntries.length) return 'GUIA_JA_CONTABILIZADA';
  if (guia.extracted?.contabilizacaoPendente) return 'GUIA_REQUER_TRATAMENTO_EXPLICITO';
  return null;
}

// Proteção adicional, não altera a data escolhida pelo gerador legado:
// último dia anterior ao vencimento, ou último dia da competência sem vencimento.
export function competenciasProtegidasBackfill(guia) {
  if (!competenciaValida(guia.competencia)) return null;
  if (!guia.vencimento) return [guia.competencia];
  const d = new Date(guia.vencimento);
  if (Number.isNaN(d.getTime())) return null;
  const anterior = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  const dataContabil = anterior.toISOString().slice(0, 7);
  return [...new Set([guia.competencia, dataContabil])];
}
