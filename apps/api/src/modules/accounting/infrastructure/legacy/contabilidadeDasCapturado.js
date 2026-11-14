import { generateEntriesFromCircular, FONTE_VALOR_GUIA } from "../../../../application/accounting/AccountingEntryGeneratorService.js";

export function gerarLancamentosDasCapturado({ portalClientId, competencia, now }) {
  return generateEntriesFromCircular({ portalClientId, competencia, now, fonteValor: FONTE_VALOR_GUIA });
}
