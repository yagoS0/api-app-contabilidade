// Q21 (spec v2) — Invariantes do parcelamento. Função pura, usada por TODAS as origens
// (entrada manual e adaptador SERPRO). A confirmação dos campos do SERPRO deixa de ser
// "ler a doc" e vira "rodar os invariantes e ver verde".
//
// Níveis:
//   1 (rejeita): não-negatividade; principal+multa+juros==total por tributo; Σ tributos==valorTotal da parcela.
//   2 (marca revisão): reconciliação por COMPONENTE contra o consolidado — detecta TROCA DE COLUNA
//      (a soma do nível 1 é comutativa e NÃO detecta multa↔juros trocados).
//   Juros: só limite inferior (Σ juros das parcelas >= juros consolidado), pois a SELIC mensal
//      não está no consolidado. NUNCA assertar igualdade nem derivar.

import { round2Decimal as round2 } from "./contracts.js";

export const TOL_LINHA = 0.01; // por tributo/parcela
export const TOL_AGG = 0.05;   // reconciliações agregadas

/** Nível 1 — valida UMA parcela (usado na ingestão, onde temos 1 parcela por vez).
 *  @returns {{ ok, erros: string[] }} */
export function validarParcela(parcela) {
  const erros = [];
  const tributos = Array.isArray(parcela?.tributos) ? parcela.tributos : [];
  if (tributos.length === 0) erros.push("Parcela sem composição por tributo.");

  for (const t of tributos) {
    const tag = t.codigoTributo || "?";
    if ([t.principal, t.multa, t.juros, t.total].some((v) => Number(v) < 0)) {
      erros.push(`Tributo ${tag}: componente negativo.`);
    }
    if (Math.abs(round2(t.principal + t.multa + t.juros) - round2(t.total)) > TOL_LINHA) {
      erros.push(`Tributo ${tag}: principal+multa+juros (${round2(t.principal + t.multa + t.juros)}) != total (${round2(t.total)}).`);
    }
  }
  const somaTrib = round2(tributos.reduce((s, t) => s + Number(t.total || 0), 0));
  if (parcela?.valorTotal != null && Math.abs(somaTrib - round2(parcela.valorTotal)) > TOL_LINHA) {
    erros.push(`Σ tributos.total (${somaTrib}) != valorTotal da parcela (${round2(parcela.valorTotal)}).`);
  }
  return { ok: erros.length === 0, erros };
}

/** Nível 2 + juros — reconcilia o conjunto de parcelas contra o consolidado do parcelamento.
 *  Usado quando se tem TODAS as parcelas (contract test / sync completo).
 *  @returns {{ ok, erros: string[], alertas: string[] }}
 *    erros = bloqueia (inclui juros abaixo do consolidado); alertas = marca p/ revisão (troca de coluna). */
export function reconciliarParcelamento(parcelamento, parcelas) {
  const erros = [];
  const alertas = [];
  const lista = Array.isArray(parcelas) ? parcelas : [];

  // Nível 1 em cada parcela primeiro
  for (const p of lista) {
    const r = validarParcela(p);
    if (!r.ok) erros.push(...r.erros);
  }

  const allTrib = lista.flatMap((p) => p.tributos || []);
  const sumP = round2(allTrib.reduce((s, t) => s + Number(t.principal || 0), 0));
  const sumM = round2(allTrib.reduce((s, t) => s + Number(t.multa || 0), 0));
  const sumJ = round2(allTrib.reduce((s, t) => s + Number(t.juros || 0), 0));

  // Nível 2 — reconciliação por componente (detecta troca de coluna). Marca revisão.
  if (parcelamento?.valorPrincipal != null && Math.abs(sumP - round2(parcelamento.valorPrincipal)) > TOL_AGG) {
    alertas.push(`Σ principal (${sumP}) diverge do principal consolidado (${round2(parcelamento.valorPrincipal)}) — revisar.`);
  }
  if (parcelamento?.valorMulta != null && Math.abs(sumM - round2(parcelamento.valorMulta)) > TOL_AGG) {
    alertas.push(`Σ multa (${sumM}) diverge da multa consolidada (${round2(parcelamento.valorMulta)}) — possível troca de coluna (multa↔juros). Revisar.`);
  }

  // Juros — só limite inferior (SELIC mensal não está no consolidado). Violar é suspeito → erro.
  if (parcelamento?.valorJuros != null && sumJ + TOL_AGG < round2(parcelamento.valorJuros)) {
    erros.push(`Σ juros das parcelas (${sumJ}) < juros consolidado (${round2(parcelamento.valorJuros)}) — inconsistente.`);
  }

  return { ok: erros.length === 0, erros, alertas };
}
