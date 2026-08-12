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
 *                                   valorPrincipal, valorMulta, valorJuros, valorTotal, dataAdesao, anoMesParcela?, vencimento?,
 *                                   formaPagamento?, diaPagamento?, saldoConsolidado?, valorParcela? }
 *                                 ⚠ `valorTotal` é o CONSOLIDADO do acordo; `valorParcela` é o valor
 *                                 CHEIO de UMA prestação. Os dois já foram confundidos aqui.
 * @param {Array}  [input.tributos] — composição informada manualmente; se ausente, usa guide.extracted.composicao
 *
 * ⚠ `guide` É OPCIONAL, E ISSO É O CORAÇÃO DO "PARCELAMENTO-FIRST". Todo acesso a ele aqui é por
 * optional chaining: sem guia, a composição fica vazia, o valor da parcela cai em 0 e a competência
 * inicial precisa vir do HEADER (`anoMesParcela`). Sem `anoMesParcela` e sem guia,
 * `ingestParcelamentoFromGuide` grava a sentinela `1970-01` e o cronograma sai SEM DATAS — o
 * contrato aparece como "0 de N" com risco não avaliável. Não é defeito novo; é a consequência de
 * não haver nenhuma data confiável, e está documentada em `parcelaSync.COMPETENCIA_SENTINELA`.
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
    // cai no valor da própria guia e, sem guia, no `valorParcela` DECLARADO pelo contador.
    //
    // ⚠ A ORDEM É PROVA → DECLARAÇÃO, e ela não é arbitrária: a composição por tributo e a guia são
    // documentos; `header.valorParcela` é o que o contador digitou. Deixá-lo vencer o documento
    // criaria a segunda fonte que este módulo evita em todo lugar (é a mesma razão de
    // `corrigirValorPrevistoParcela` recusar prestação COM guia).
    //
    // ⚠ SEM ELE, O CONTRATO DO WIZARD NASCIA VALENDO ZERO. `ingestParcelamentoFromGuide` grava
    // `valorParcelaReferencia = round2(parc.valorTotal)`, e `parcelaSync` copia isso para o
    // `valorPrevisto` de cada prestação: contrato inteiro não baixável (`sem_valor_previsto`), com
    // `principalPago` em zero para sempre. É a forma da SINTROPIA nº 1 em produção.
    valorTotal: trib.length ? undefined : (guide?.valor ?? header.valorParcela ?? undefined),
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
    // F2.3 — dados do CONTRATO, coletados no modal. `diaPagamento` alimenta o cronograma
    // (`parcelaSync`), que é a data que decide atraso quando não há guia; `saldoConsolidado` é
    // informativo e não vira lançamento; `formaPagamento` é declaração (null = não declarado).
    formaPagamento: header.formaPagamento,
    diaPagamento: header.diaPagamento,
    saldoConsolidado: header.saldoConsolidado,
  });

  return { parcelamentoDTO, parcelaDTO };
}
