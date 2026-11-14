import { preverCorrecaoValorGuia as prever } from "../modules/guides/application/preverCorrecaoValorGuia.js";
import { criarLeituraDocumentalCorrecaoValorGuia } from "../modules/guides/infrastructure/documentos/leituraDocumentalCorrecaoValorGuia.js";
import { lerGuiaParaCorrecaoValor } from "../modules/guides/infrastructure/prisma/leituraGuiaCorrecaoValor.js";
import { incluirProvisoesParaCorrecaoValor } from "../modules/accounting/infrastructure/prisma/leituraProvisoesCorrecaoValor.js";
import { competenciasFechadas } from "../application/accounting/fechamentoContabil.js";

export function lerGuiaComProvisoes(db, companyId, guideId) {
  return lerGuiaParaCorrecaoValor(db, companyId, guideId, incluirProvisoesParaCorrecaoValor());
}

export function lerFechamentoParaCorrecao(db, companyId, competencias) {
  return competenciasFechadas(companyId, competencias, db);
}

export function comporLeiturasCorrecaoValorGuia(db, documento) {
  return {
    lerGuia: (companyId, guideId) => lerGuiaComProvisoes(db, companyId, guideId),
    lerFechamento: (companyId, competencias) => lerFechamentoParaCorrecao(db, companyId, competencias),
    lerDocumento: criarLeituraDocumentalCorrecaoValorGuia(documento),
  };
}

export async function preverCorrecaoValorGuia(args, { db, carregarPdf, ler } = {}) {
  return prever(args, comporLeiturasCorrecaoValorGuia(db, { carregarPdf, ler }));
}
