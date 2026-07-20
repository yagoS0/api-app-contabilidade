// Q21 (spec v2) — Contrato interno do parcelamento (DTO).
//
// Toda origem (entrada manual = referência; adaptador SERPRO) produz ESTES DTOs.
// Nada a jusante (vínculo/provisão/pagamento/circular) conhece o formato do SERPRO.
//
// TributoDTO  : { codigoTributo, nomeTributo?, principal, multa, juros, total }  (juros LIDO, nunca derivado)
// ParcelaDTO  : { numeroParcela, quantidadeParcelas, anoMesParcela, vencimento?, valorTotal, tributos: TributoDTO[] }
// ParcelamentoDTO : { tipo, numeroParcelamento, valorTotal, valorPrincipal, valorMulta, valorJuros,
//                     quantidadeParcelas, parcelaInicial?, dataAdesao?, origem }

export const TIPOS_PARCELAMENTO = [
  "PARCSN", "PARCSN_ESPECIAL", "PERT_SN", "RELP_SN",
  "PARCMEI", "PARCMEI_ESPECIAL", "PERT_MEI", "RELP_MEI",
  "INSS", // Q61: parcelamento previdenciário/INSS (manual — sem auto-search SERPRO)
  "OUTRO",
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

/** Normaliza um TributoDTO. `total` é derivado de p+m+j quando ausente (conveniência manual);
 *  quando vem (SERPRO/PDF), é mantido pra os invariantes confrontarem. */
export function normalizeTributoDTO(raw = {}) {
  const principal = round2(raw.principal);
  const multa = round2(raw.multa);
  const juros = round2(raw.juros); // LIDO — nunca derivado por subtração
  const total = raw.total != null ? round2(raw.total) : round2(principal + multa + juros);
  return {
    codigoTributo: String(raw.codigoTributo || raw.codigo || "").trim(),
    nomeTributo: raw.nomeTributo || raw.denominacao || null,
    principal, multa, juros, total,
  };
}

/** Normaliza um ParcelaDTO. `valorTotal` deriva da soma dos tributos quando ausente. */
export function normalizeParcelaDTO(raw = {}) {
  const tributos = Array.isArray(raw.tributos) ? raw.tributos.map(normalizeTributoDTO) : [];
  const somaTrib = round2(tributos.reduce((s, t) => s + t.total, 0));
  return {
    numeroParcela: raw.numeroParcela != null ? Number(raw.numeroParcela) : null,
    quantidadeParcelas: raw.quantidadeParcelas != null ? Number(raw.quantidadeParcelas) : null,
    anoMesParcela: raw.anoMesParcela ? String(raw.anoMesParcela) : null, // YYYYMM
    vencimento: raw.vencimento || null,
    valorTotal: raw.valorTotal != null ? round2(raw.valorTotal) : somaTrib,
    tributos,
  };
}

/** Normaliza o ParcelamentoDTO (cabeçalho consolidado). */
export function normalizeParcelamentoDTO(raw = {}) {
  return {
    tipo: String(raw.tipo || "OUTRO").trim().toUpperCase(),
    numeroParcelamento: raw.numeroParcelamento != null ? String(raw.numeroParcelamento).trim() : null,
    valorTotal: raw.valorTotal != null ? round2(raw.valorTotal) : null,
    valorPrincipal: raw.valorPrincipal != null ? round2(raw.valorPrincipal) : null,
    valorMulta: raw.valorMulta != null ? round2(raw.valorMulta) : null,
    valorJuros: raw.valorJuros != null ? round2(raw.valorJuros) : null,
    quantidadeParcelas: raw.quantidadeParcelas != null ? Number(raw.quantidadeParcelas) : null,
    parcelaInicial: raw.parcelaInicial != null ? Number(raw.parcelaInicial) : null,
    dataAdesao: raw.dataAdesao || null,
    origem: String(raw.origem || "MANUAL").toUpperCase(),
  };
}

export { round2 as round2Decimal, num as toNumber };
