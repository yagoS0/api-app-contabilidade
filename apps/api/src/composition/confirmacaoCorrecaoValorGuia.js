import { lerGuiaComProvisoes, lerFechamentoParaCorrecao } from "./leiturasCorrecaoValorGuia.js";
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
