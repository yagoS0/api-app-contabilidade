// Q21 (spec v2) — Entrada MANUAL = implementação de REFERÊNCIA do contrato.
// Constrói os DTOs (ParcelamentoDTO + ParcelaDTO) a partir do que o contador informa +
// da composição já extraída do PDF da guia (extracted.composicao). Não depende do SERPRO.

import { normalizeParcelamentoDTO, normalizeParcelaDTO } from "./contracts.js";

// "2026-05" | "202605" | Date → "202605"
function toAnoMes(competencia) {
  if (!competencia) return null;
  const s = String(competencia);
  const digits = s.replace(/\D+/g, "");
  if (digits.length >= 6) return digits.slice(0, 6);
  return null;
}

/**
 * Monta os DTOs a partir do payload do endpoint manual.
 * @param {Object} input
 * @param {Object} input.guide  — Guide (usa competencia/vencimento + extracted.composicao como default)
 * @param {Object} input.header — { tipo, numeroParcelamento, quantidadeParcelas, numeroParcela,
 *                                   valorPrincipal, valorMulta, valorJuros, valorTotal, dataAdesao, anoMesParcela?, vencimento? }
 * @param {Array}  [input.tributos] — composição informada manualmente; se ausente, usa guide.extracted.composicao
 */
export function buildDTOsFromManual({ guide, header = {}, tributos }) {
  const composicao = Array.isArray(tributos) && tributos.length
    ? tributos
    : (Array.isArray(guide?.extracted?.composicao) ? guide.extracted.composicao : []);

  const trib = composicao
    .map((c) => ({
      codigoTributo: String(c.codigoTributo || c.codigo || "").trim(),
      nomeTributo: c.nomeTributo || c.denominacao || null,
      principal: c.principal,
      multa: c.multa,
      juros: c.juros,
      total: c.total,
    }))
    .filter((c) => c.codigoTributo);

  const anoMes = toAnoMes(header.anoMesParcela) || toAnoMes(guide?.competencia);
  const vencimento = header.vencimento || guide?.vencimento || null;

  const parcelaDTO = normalizeParcelaDTO({
    numeroParcela: header.numeroParcela,
    quantidadeParcelas: header.quantidadeParcelas,
    anoMesParcela: anoMes,
    vencimento,
    // valorTotal da PARCELA = soma da composição (derivado em normalizeParcelaDTO quando ausente).
    // NÃO usar header.valorTotal — esse é o CONSOLIDADO do parcelamento (vai só no parcelamentoDTO);
    // confundir os dois fazia Σ tributos != valorTotal e estourava COMPOSICAO_INVALIDA. Sem composição,
    // cai no valor da própria guia.
    valorTotal: trib.length ? undefined : guide?.valor,
    tributos: trib,
  });

  const parcelamentoDTO = normalizeParcelamentoDTO({
    tipo: header.tipo,
    numeroParcelamento: header.numeroParcelamento,
    quantidadeParcelas: header.quantidadeParcelas,
    parcelaInicial: header.numeroParcela,
    valorTotal: header.valorTotal,
    valorPrincipal: header.valorPrincipal,
    valorMulta: header.valorMulta,
    valorJuros: header.valorJuros,
    dataAdesao: header.dataAdesao,
    origem: "MANUAL",
  });

  return { parcelamentoDTO, parcelaDTO };
}
