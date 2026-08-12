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
 * O SALDO DO PASSIVO DE UM PARCELAMENTO — a leitura do RAZÃO, não do cabeçalho do contrato.
 *
 * ⚠ ELE RESPONDE UMA PERGUNTA DIFERENTE DE `saldoContratual`, e é por isso que existe com nome
 * próprio. "Quanto falta pagar do acordo" sai do CONTRATO (principal total ÷ prestações); "quanto
 * ainda resta em Parcelamento a Pagar" sai dos LANÇAMENTOS. Enquanto os dois moravam num nome só
 * (`saldoRestante`), a tela dava a resposta de um deles para as duas perguntas — e nenhuma das duas
 * estava certa, porque a base era `principalPerParcela`, que guarda coisas diferentes conforme quem
 * escreveu (o V1 grava o principal por prestação; o V2 grava o valor CHEIO).
 *
 * A conta é o SALDO CREDOR do papel `PARC` dentro dos lançamentos do contrato, e cada sinal já vem
 * do próprio lançamento — nenhum caso especial por tipo:
 *
 *   · provisão da adesão   `C PARC`  → reconhece o passivo            (+)
 *   · baixa da prestação   `D PARC`  → amortiza                       (−)
 *   · espelho do estorno   `C PARC`  → devolve o que a baixa amortizou (+)
 *   · rescisão (estorno da provisão) `D PARC` → baixa o que sobrou    (−)
 *
 * ⚠ SEM NENHUMA LINHA `PARC`, A RESPOSTA É `null` — NUNCA ZERO. Contrato do V1 (`createParcelamento`)
 * grava a abertura sem `tipoLinha` em lugar nenhum: dele não se sabe qual perna é o passivo, e zero
 * afirmaria um acordo quitado. É o mesmo padrão de `conferenciaDoPassivoPorContrato`
 * (`principalProvisionado: null` sem provisão) e de `analitica: null` no plano de contas.
 *
 * @param {Array<{tipo: string, valor: any}>} linhas linhas com `tipoLinha === "PARC"` do contrato
 * @returns {number|null}
 */
export function saldoPassivoDasLinhasParc(linhas) {
  const lista = Array.isArray(linhas) ? linhas : [];
  if (!lista.length) return null;
  const saldo = lista.reduce((s, l) => {
    const v = Number(l?.valor || 0);
    return String(l?.tipo).toUpperCase() === "C" ? s + v : s - v;
  }, 0);
  // ⚠ NÃO SE CORTA EM ZERO. Passivo negativo é o sintoma de que a baixa amortizou mais do que a
  // provisão reconheceu (é exatamente o resíduo invertido que `diag-residuo-provisao-consolidada`
  // mede), e escondê-lo atrás de um `Math.max(0, …)` apagaria da tela o número que denuncia o
  // desalinhamento entre adesão e baixa.
  return r2(saldo);
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
