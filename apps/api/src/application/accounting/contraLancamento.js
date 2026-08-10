// O ESPELHO INVERTIDO — como este projeto desfaz um lançamento que NÃO PODE SER APAGADO.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// POR QUE ISTO SAIU DE DENTRO DO `EstornoBaixaService`
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// A regra "mês fechado → contra-lançamento, nunca DELETE" nasceu no estorno da baixa e vivia inteira
// dentro do laço de `executarEstorno`. Ela deixou de ser exclusiva dele no momento em que o
// PARCELAMENTO ganhou dois atos próprios que também desfazem lançamentos — a EXCLUSÃO do contrato e
// o DESFAZER da rescisão (`AtosParcelamentoService.js`).
//
// ⚠ E a segunda cópia seria o defeito, não o incômodo. Este arquivo carrega QUATRO decisões que só
// se leem juntas, e todas as quatro já custaram um ciclo cada uma no estorno:
//
//   1. **`tipo: "ESTORNO"`, nunca `"BAIXA"`.** Em mês fechado a linha original CONTINUA na tabela,
//      então um espelho gravado como BAIXA repetiria `(sourceGuideId, tipoLinha, codigoTributo)` —
//      que é, letra por letra, a assinatura de uma baixa DUPLICADA para `uq_baixa_guia_linha`. 23505.
//      As duas travas da migration `20260808120000_add_baixa_tipo_linha` são parciais em
//      `tipo='BAIXA'`, então `ESTORNO` as deixa inertes **por construção**, sem afrouxar nenhuma.
//   2. **`eventType: null`.** Só o lançamento original carrega o evento; repetir violaria
//      `@@unique([portalClientId, competencia, eventType, origem])` no segundo espelho do mesmo
//      evento no mesmo mês.
//   3. **`openEntryId` e `sourceGuideId` FICAM.** É o vínculo com a provisão que permite a
//      `computeSaldoProvisao` SUBTRAIR o que a linha original ainda soma (ela não foi apagada), e é
//      o vínculo com a guia que torna o espelho rastreável a partir do documento.
//   4. **`parcelamentoId` FICA, e é obrigatório quando existe.** O lote do parcelamento só balanceia
//      EM GRUPO (cada lançamento tem uma perna só) e `computeFechamentoBlockers` agrupa por
//      `parcelamentoId` — sem ele, os espelhos apareceriam como N lançamentos desbalanceados e
//      TRAVARIAM o fechamento do mês seguinte. ⚠ Esta é também a razão de a exclusão do contrato
//      **não apagar o cabeçalho** quando sobra lançamento em competência fechada: sem a linha de
//      `parcelamentos`, a FK vira NULL (`onDelete: SetNull`) e o grupo se desfaz.
//
// O que varia entre os chamadores é só o RÓTULO (o prefixo do histórico e do lote). O resto é a
// mesma decisão contábil, e é isso que esta função existe para manter única.

/**
 * Cria o espelho invertido de um lançamento, na competência informada.
 *
 * @param {object} tx  cliente Prisma DENTRO da transação de quem desfaz — nunca o global: o espelho
 *   e a mudança de estado que ele acompanha ou acontecem juntos ou não acontecem.
 * @param {object} entry lançamento original, com `lines` carregadas.
 * @param {string} competencia competência ABERTA onde o espelho nasce (a de HOJE, nos dois usos —
 *   escolher "a primeira aberta que eu achar" seria datar um fato contábil por conveniência).
 * @param {string} rotulo prefixo do histórico e do `loteImportacao` (`ESTORNO` | `EXCLUSAO` | …).
 * @returns {Promise<{id: string, historico: string, competencia: string}>}
 */
export async function criarContraLancamento(tx, {
  portalClientId, entry, competencia, agora = new Date(), rotulo = "ESTORNO",
}) {
  return tx.accountingEntry.create({
    data: {
      portalClientId,
      data: agora,
      competencia,
      historico: `${rotulo} ${entry.historico} (${entry.competencia})`,
      // ⚠ Decisão 1 — ver o cabeçalho.
      tipo: "ESTORNO",
      subtipo: entry.subtipo,
      origem: "MANUAL",
      status: "RASCUNHO",
      statusPagamento: "NA",
      // ⚠ Decisão 2.
      eventType: null,
      // ⚠ Decisão 3.
      openEntryId: entry.openEntryId,
      sourceGuideId: entry.sourceGuideId,
      // ⚠ Decisão 4.
      parcelamentoId: entry.parcelamentoId,
      numeroParcela: entry.numeroParcela ?? null,
      loteImportacao: `${rotulo}-${String(entry.id).slice(0, 8)}`,
      tipoLinha: entry.tipoLinha,
      codigoTributo: entry.codigoTributo,
      estornoDeEntryId: entry.id,
      lines: {
        createMany: {
          // O ESPELHO: mesmas contas, mesmos valores, D↔C invertidos. Nada de "conta de estorno" —
          // o que desfaz um débito em 553 é um crédito em 553, na própria conta.
          data: (entry.lines || []).map((l, i) => ({
            conta: l.conta,
            tipo: String(l.tipo).toUpperCase() === "D" ? "C" : "D",
            valor: Number(l.valor || 0),
            ordem: i,
            tipoLinha: l.tipoLinha || null,
            codigoTributo: l.codigoTributo || null,
          })),
        },
      },
    },
    select: { id: true, historico: true, competencia: true },
  });
}

/** A competência (YYYY-MM) de uma data, em UTC — a mesma conta que o estorno já fazia. */
export function competenciaDe(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
