import { lerGuiaComProvisoes, lerFechamentoParaCorrecao, preverCorrecaoValorGuia } from "./leiturasCorrecaoValorGuia.js";
import { confirmarCorrecaoValorGuia } from "../modules/guides/application/confirmarCorrecaoValorGuia.js";
import {
  emTransacaoSerializable, atualizarValorGuia, registrarAuditoriaCorrecao,
} from "../modules/guides/infrastructure/prisma/confirmacaoCorrecaoValorGuia.js";
import { corrigirProvisao } from "../modules/accounting/infrastructure/prisma/correcaoProvisaoValorGuia.js";

export function transacaoConfirmacaoCorrecaoValorGuia(db, executar) {
  return emTransacaoSerializable(db, tx => executar({
    lerGuia: (companyId, guideId) => lerGuiaComProvisoes(tx, companyId, guideId),
    lerFechamento: (companyId, competencias) => lerFechamentoParaCorrecao(tx, companyId, competencias),
    atualizarValorGuia: dados => atualizarValorGuia(tx, dados),
    corrigirProvisao: (entrada, novoValor) => corrigirProvisao(tx, entrada, novoValor),
    registrarAuditoria: dados => registrarAuditoriaCorrecao(tx, dados),
  }));
}

export async function corrigirValorGuia({ companyId, guideId, valor, revisao, userId }, deps = {}) {
  const db = deps.db || undefined;
  return confirmarCorrecaoValorGuia({ companyId, guideId, valor, revisao, userId }, {
    prever: args => preverCorrecaoValorGuia(args, deps),
    emTransacao: executar => transacaoConfirmacaoCorrecaoValorGuia(db, executar),
  });
}
