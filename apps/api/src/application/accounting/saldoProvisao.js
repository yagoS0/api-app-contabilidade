// SALDO DA PROVISÃO — principal reconhecido menos o principal já amortizado.
//
// Morava dentro de `routes/firm/accountingEntries.js` e servia a quatro pontos daquela fábrica. Saiu
// de lá quando o ESTORNO passou a precisar da MESMA conta: em mês fechado o estorno não apaga a
// baixa, ele cria um espelho invertido, e quem não souber subtrair o espelho lê o passivo errado.
// Duas cópias dessa conta fariam a tela de baixa e o estorno discordarem sobre quanto a empresa
// ainda deve, que é o número que decide se cabe outra baixa.
//
// `entry` deve vir com `lines` e `baixas: { lines }` — `baixas` é a relação por `openEntryId`, e ela
// traz TUDO que pendura na provisão, inclusive os contra-lançamentos.

import { CONTAS_ACRESCIMO } from "./contasAcrescimo.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Soma de um lado (D|C) ignorando as contas de acréscimo (juros 501 / multa 506). */
function ladoNaoAcrescimo(entry, lado) {
  return (entry?.lines || [])
    .filter((l) => String(l.tipo).toUpperCase() === lado && !CONTAS_ACRESCIMO.has(String(l.conta).trim()))
    .reduce((s, l) => s + Number(l.valor || 0), 0);
}

/**
 * O PRINCIPAL abatido por uma baixa = débitos que NÃO são acréscimo. Juros e multa são despesa do
 * mês do pagamento, não amortização do passivo — por isso ficam fora.
 */
export function principalAbatidoDaBaixa(baixa) {
  return ladoNaoAcrescimo(baixa, "D");
}

/**
 * @param {object} entry provisão com `lines` e `baixas: { lines }`
 * @returns {{principal:number, abatido:number, saldo:number, quotasPagas:number}}
 */
export function computeSaldoProvisao(entry) {
  const lines = entry?.lines || [];
  const principal = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const pendurados = Array.isArray(entry?.baixas) ? entry.baixas : [];

  // ⚠ O CONTRA-LANÇAMENTO DE ESTORNO PENDURA NA MESMA PROVISÃO, E TEM DE SUBTRAIR.
  //
  // Ele carrega `openEntryId` de propósito: em mês FECHADO a baixa original continua na tabela e
  // continua somando aqui; o espelho é a única coisa que a anula. Sem esta separação por `tipo`, o
  // débito de CAIXA do espelho (`D caixa / C 553`) seria lido como MAIS uma amortização — a
  // provisão iria para o lado errado em DOBRO justamente na operação que deveria devolvê-la ao
  // aberto. É a mesma razão de o espelho não ser `tipo:"BAIXA"` (ver `EstornoBaixaService.js`).
  //
  // No espelho o lado é invertido, então o que ele devolve ao passivo são os CRÉDITOS não-acréscimo.
  const baixas = pendurados.filter((b) => String(b.tipo || "").toUpperCase() !== "ESTORNO");
  const estornos = pendurados.filter((b) => String(b.tipo || "").toUpperCase() === "ESTORNO");

  const abatidoBruto = baixas.reduce((s, b) => s + principalAbatidoDaBaixa(b), 0);
  const devolvido = estornos.reduce((s, b) => s + ladoNaoAcrescimo(b, "C"), 0);
  const abatido = r2(Math.max(0, abatidoBruto - devolvido));

  const saldoRaw = r2(principal - abatido);
  return {
    principal: r2(principal),
    abatido,
    saldo: saldoRaw > 0 ? saldoRaw : 0,
    // Uma quota estornada deixa de contar: senão a próxima baixa nasceria numerada como se a
    // anterior tivesse acontecido.
    quotasPagas: Math.max(0, baixas.length - estornos.length),
  };
}
