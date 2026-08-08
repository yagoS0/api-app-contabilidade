// PAPEL DA LINHA NO CABEÇALHO DA BAIXA — o campo que o banco usa para separar as linhas legítimas
// de um mesmo lote das linhas de uma baixa DUPLICADA.
//
// ⚠ POR QUE ISTO É OBRIGATÓRIO EM TODA BAIXA. A migration `20260808120000_add_baixa_tipo_linha`
// criou `CHECK (tipo <> 'BAIXA' OR "tipoLinha" IS NOT NULL)`. Caminho que gravar `tipo:"BAIXA"` sem
// `tipoLinha` NÃO falha em teste (não há banco lá) — falha em PRODUÇÃO, com erro 23514. Os caminhos
// que sabem o papel (INSS, parcelamento, rota de baixa) passam o papel; os genéricos usam o padrão.
//
// ⚠ `TOTAL` NÃO É "principal". É a ausência de decomposição: um lançamento de baixa digitado à mão,
// importado de OFX/Excel ou vindo de uma função de lançamento é o pagamento INTEIRO, e chamá-lo de
// PRINCIPAL afirmaria que ele amortiza o passivo e que juros/multa estão em outro lugar — o que
// ninguém sabe. O vocabulário é o mesmo do `AccountingEntryLine.tipoLinha` (Q21), que já tem TOTAL.
export const TIPO_LINHA_BAIXA_PADRAO = "TOTAL";

/**
 * Valor de `tipoLinha` para um lançamento que está sendo criado.
 * @param {string} tipo   tipo do AccountingEntry (DESPESA | ... | BAIXA)
 * @param {string} [papel] papel conhecido da linha (PRINCIPAL | JUROS | MULTA | PARC | CAIXA | ...)
 * @returns {string|null} null quando não é baixa — a coluna só é cobrada em BAIXA.
 */
export function tipoLinhaDaBaixa(tipo, papel) {
  if (String(tipo || "").toUpperCase() !== "BAIXA") return null;
  const p = String(papel || "").trim().toUpperCase();
  return p || TIPO_LINHA_BAIXA_PADRAO;
}
