import { prisma } from "../../infrastructure/db/prisma.js";
import { comporLeiturasCorrecaoValorGuia } from "../../composition/leiturasCorrecaoValorGuia.js";
import { transacaoConfirmacaoCorrecaoValorGuia } from "../../composition/confirmacaoCorrecaoValorGuia.js";
import { confirmarCorrecaoValorGuia } from "../../modules/guides/application/confirmarCorrecaoValorGuia.js";
import { CorrecaoValorError, preverCorrecaoValorGuia as prever } from "../../modules/guides/application/preverCorrecaoValorGuia.js";

export { CorrecaoValorError };

export async function preverCorrecaoValorGuia(args, { db = prisma, carregarPdf, ler } = {}) {
  return prever(args, comporLeiturasCorrecaoValorGuia(db, { carregarPdf, ler }));
}

export async function corrigirValorGuia({ companyId, guideId, valor, revisao, userId }, deps = {}) {
  const db = deps.db || prisma;
  return confirmarCorrecaoValorGuia({ companyId, guideId, valor, revisao, userId }, {
    prever: args => preverCorrecaoValorGuia(args, deps),
    emTransacao: executar => transacaoConfirmacaoCorrecaoValorGuia(db, executar),
  });
}
