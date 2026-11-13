export async function corrigirProvisao(tx, entrada, novoValor) {
  await tx.accountingEntryLine.updateMany({ where: { entryId: entrada.id }, data: { valor: novoValor } });
  await tx.accountingEntry.update({ where: { id: entrada.id }, data: {
    recalculatedAt: new Date(), recalculatedFromValor: entrada.lines[0].valor, recalculatedToValor: novoValor,
    recalculatedNotes: "Correção de cadastro conferida contra o PDF original da guia.",
  } });
}
