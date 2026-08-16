// O PRINCIPAL DESTA BAIXA × O SALDO DA PROVISÃO — a antecipação da recusa do servidor.
//
// ⚠ ESTA REGRA É ESPELHO, NÃO SEGUNDA OPINIÃO. Ela reproduz, campo a campo, o que
// `POST /firm/companies/:id/entries/:entryId/baixa` calcula antes de recusar com
// **400 `baixa_excede_saldo`** (`routes/firm/accountingEntries.js`): a soma dos DÉBITOS cujo código
// de conta NÃO é acréscimo, comparada com `computeSaldoProvisao(entry).saldo`, tolerância de um
// centavo. Quem recusa continua sendo o servidor — o que mora aqui é a antecipação, para o motivo
// não ser descoberto depois do clique.
//
// ⚠ O CRITÉRIO É A CONTA, NÃO O PAPEL — e isso é deliberado, não descuido.
// `contasAcrescimo.js` avisa que as constantes "NÃO são o critério para saber o que é juros e o que
// é multa" (o `papel` é), e mesmo assim `principalDestaBaixa` filtra por CONTA. Enquanto for assim
// no servidor, tem de ser assim aqui: uma tela que somasse por papel diria "cabe" onde o servidor
// diz "não cabe", e o contador voltaria ao formulário sem entender o que mudou. Se o servidor um dia
// passar a somar por papel, este módulo muda junto — no mesmo commit.
//
// POR QUE ISTO EXISTE (caso real, medido em produção em 2026-08-16)
// LENTE - MEDICAL MARKETING, DAS de 2026-06: provisão de R$ 14.115,30 e comprovante do SERPRO com
// `principal: 15.033,58` (a guia foi RECALCULADA — pagamento em 14/07, com R$ 918,28 de acréscimo
// que o comprovante não quebra: ele devolve `juros: 0` e `multa: 0`). O modal prefere o comprovante
// à sugestão do template, monta `D 15.033,58 / C 15.033,58` — **balanceado**, portanto com o botão
// Confirmar HABILITADO — e o servidor recusa, porque a baixa amortizaria R$ 918,28 a mais de passivo
// do que foi provisionado.
//
// ⚠ A SAÍDA NÃO É RATEAR SOZINHO. O acréscimo sem quebra confiável não vira lançamento por
// suposição (é a mesma regra de `sem_rateio_do_acrescimo` do INSS): quem diz quanto é juros e quanto
// é multa é o contador, nas linhas 501/506. Por isso a recusa nomeia o excedente e diz onde ele vai.

/** Mesmos códigos do backend (`application/accounting/contasAcrescimo.js`). */
export const CONTA_JUROS = "501";
export const CONTA_MULTA = "506";
export const CONTAS_ACRESCIMO = new Set([CONTA_JUROS, CONTA_MULTA]);

/** O código da recusa, igual ao do servidor — é ele que identifica o caso num chamado de suporte. */
export const RECUSA_EXCEDE_SALDO = "baixa_excede_saldo";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function valorDaLinha(linha) {
  // O input do modal é texto; o servidor faz `parseFloat(String(valor).replace(",", "."))`.
  const bruto = String(linha?.valor ?? "").replace(",", ".");
  const n = parseFloat(bruto);
  return Number.isFinite(n) ? n : 0;
}

/**
 * O principal que ESTA baixa amortiza — os débitos que não são acréscimo.
 * @param {Array<{tipo?: string, conta?: string, valor?: any}>} lines
 * @returns {number}
 */
export function principalDaBaixa(lines) {
  return r2(
    (Array.isArray(lines) ? lines : [])
      .filter((l) => String(l?.tipo).toUpperCase() === "D" && !CONTAS_ACRESCIMO.has(String(l?.conta ?? "").trim()))
      .reduce((s, l) => s + valorDaLinha(l), 0),
  );
}

/**
 * A recusa antecipada, ou `null` quando nada bloqueia.
 *
 * ⚠ `saldoInfo` AUSENTE NÃO AFIRMA NADA. Ele vem do `GET .../baixa-template`; se a chamada não
 * voltou (ou a tela não a faz), não se sabe qual é o saldo — e recusar por falta de dado travaria
 * uma baixa legítima. Ausência nunca é resposta: sem `saldoInfo`, quem decide é só o servidor.
 *
 * @param {Array<object>} lines linhas do modal
 * @param {{principal?: number, abatido?: number, saldo?: number}|null|undefined} saldoInfo
 * @returns {{codigo: string, principal: number, saldo: number, excedente: number, motivo: string, saida: string}|null}
 */
export function conferirPrincipalContraSaldo(lines, saldoInfo) {
  if (!saldoInfo || !Number.isFinite(Number(saldoInfo.saldo))) return null;
  const principal = principalDaBaixa(lines);
  const saldo = r2(saldoInfo.saldo);
  const excedente = r2(principal - saldo);
  if (excedente <= 0.01) return null;

  const brl = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    codigo: RECUSA_EXCEDE_SALDO,
    principal,
    saldo,
    excedente,
    motivo:
      `O principal desta baixa (R$ ${brl(principal)}) excede o saldo da provisão (R$ ${brl(saldo)}) `
      + `em R$ ${brl(excedente)}.`,
    saida:
      `Esses R$ ${brl(excedente)} são acréscimo — juros e multa são despesa do mês do pagamento, não `
      + `amortização do passivo. Reduza o principal para R$ ${brl(saldo)} e lance a diferença nas `
      + `contas de juros (${CONTA_JUROS}) e multa (${CONTA_MULTA}), com o papel marcado. `
      + `Se o valor provisionado é que está errado, corrija a provisão antes de baixar.`,
  };
}
