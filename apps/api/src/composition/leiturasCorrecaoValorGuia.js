import { lerGuiaParaCorrecaoValor } from "../modules/guides/infrastructure/prisma/leituraGuiaCorrecaoValor.js";
import { incluirProvisoesParaCorrecaoValor } from "../modules/accounting/infrastructure/prisma/leituraProvisoesCorrecaoValor.js";
import { competenciasFechadas } from "../application/accounting/fechamentoContabil.js";

export function lerGuiaComProvisoes(db, companyId, guideId) {
  return lerGuiaParaCorrecaoValor(db, companyId, guideId, incluirProvisoesParaCorrecaoValor());
}

export function lerFechamentoParaCorrecao(db, companyId, competencias) {
  return competenciasFechadas(companyId, competencias, db);
}
