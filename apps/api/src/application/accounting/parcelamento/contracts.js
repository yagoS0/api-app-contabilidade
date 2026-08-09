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

/**
 * F2.3 — as duas formas de pagar um parcelamento, como VOCABULÁRIO FECHADO.
 *
 * ⚠ O terceiro estado é `null` = NÃO DECLARADO, e ele não é a mesma coisa que nenhum dos dois.
 * Valor desconhecido também cai em `null`: aceitar uma string livre aqui deixaria a coluna
 * (que tem CHECK no banco) derrubar a ingestão inteira por causa de um typo do payload.
 */
export const FORMAS_PAGAMENTO = ["DEBITO_AUTOMATICO", "GUIA_MENSAL"];

export function normalizeFormaPagamento(raw) {
  const v = String(raw || "").trim().toUpperCase();
  return FORMAS_PAGAMENTO.includes(v) ? v : null;
}

/** Normaliza o ParcelamentoDTO (cabeçalho consolidado). */
export function normalizeParcelamentoDTO(raw = {}) {
  // ⚠ `diaPagamento`: 1..31, clampado. É ele que gera o cronograma (`parcelaSync.calendarioDaParcela`)
  // e, portanto, a data que decide ATRASO quando não há guia. Ausente ⇒ `null`, e quem grava decide
  // o que fazer com a ausência — devolver 1 aqui esconderia "não informado" atrás de um dia válido,
  // que é exatamente como os 3 contratos de produção acabaram todos com vencimento no dia 1.
  const dia = raw.diaPagamento != null ? Math.trunc(Number(raw.diaPagamento)) : null;
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
    // F2.3 — o contrato passa a carregar COMO se paga e QUANTO ainda se deve.
    formaPagamento: normalizeFormaPagamento(raw.formaPagamento),
    diaPagamento: Number.isFinite(dia) ? Math.min(31, Math.max(1, dia)) : null,
    // ⚠ INFORMATIVO. Não vira lançamento em lugar nenhum — ver o comentário do campo no schema e o
    // motivo em `ParcelamentoV2Service.linhasProvisao`.
    saldoConsolidado: raw.saldoConsolidado != null ? round2(raw.saldoConsolidado) : null,
  };
}

export { round2 as round2Decimal, num as toNumber };
