import { criarCancelamentoFiscal } from '../modules/nfse/application/cancelamentoFiscal.js';
import { criarPersistenciaCancelamento } from '../modules/nfse/infrastructure/prisma/cancelamentoFiscal.js';
import { verificarXmlEventoOficial } from '../modules/nfse/infrastructure/http/cancelamentoFiscal.js';
import { processarAvisoDaEmissao } from '../application/notas/pendenciasDoPeriodo.js';
import { log } from '../config.js';

export const executarCancelamentoFiscal = criarCancelamentoFiscal({
  ...criarPersistenciaCancelamento(undefined, { aposConfirmacao: async (invoice, prisma) => {
    try { await processarAvisoDaEmissao(prisma, invoice); }
    catch (erro) { log?.error?.({ invoiceId: invoice.id, erro: erro.message }, 'Aviso do evento aguarda processamento local'); }
  } }),
  verificarResposta: verificarXmlEventoOficial,
});
