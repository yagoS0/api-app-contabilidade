import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { comporLeiturasCorrecaoValorGuia } from "../../composition/leiturasCorrecaoValorGuia.js";
import {
  carregarGuiaParaCorrecao, CorrecaoValorError, preverCorrecaoValorGuia as prever,
} from "../../modules/guides/application/preverCorrecaoValorGuia.js";

export { CorrecaoValorError };
const recusar = (code, message, status) => { throw new CorrecaoValorError(code, message, status); };

function carregar(db, companyId, guideId, novoValor) {
  return carregarGuiaParaCorrecao({ companyId, guideId, novoValor }, comporLeiturasCorrecaoValorGuia(db));
}

export async function preverCorrecaoValorGuia(args, { db = prisma, carregarPdf, ler } = {}) {
  return prever(args, comporLeiturasCorrecaoValorGuia(db, { carregarPdf, ler }));
}

export async function corrigirValorGuia({ companyId, guideId, valor, revisao, userId }, deps = {}) {
  const db = deps.db || prisma;
  if (!userId || !revisao) recusar("revisao_obrigatoria", "Confira a prévia antes de corrigir a guia.", 400);
  const previa = await preverCorrecaoValorGuia({ companyId, guideId, valor }, deps);
  if (revisao !== previa.revisao) recusar("guia_alterada", "A guia ou o lançamento mudou. Abra uma nova prévia.");
  try {
    return await db.$transaction(async tx => {
      const atual = await carregar(tx, companyId, guideId, previa.novoValor);
      if (atual.revisao !== revisao) recusar("guia_alterada", "A guia ou o lançamento mudou. Abra uma nova prévia.");
      const alterada = await tx.guide.updateMany({ where: { id: guideId, portalClientId: companyId, updatedAt: atual.g.updatedAt }, data: {
        valor: previa.novoValor, ...previa._leitura, reviewedByUserId: userId, reviewedAt: new Date(),
      } });
      if (alterada.count !== 1) recusar("guia_alterada", "A guia mudou. Abra uma nova prévia.");
      for (const e of atual.g.accountingEntries) {
        await tx.accountingEntryLine.updateMany({ where: { entryId: e.id }, data: { valor: previa.novoValor } });
        await tx.accountingEntry.update({ where: { id: e.id }, data: {
          recalculatedAt: new Date(), recalculatedFromValor: e.lines[0].valor, recalculatedToValor: previa.novoValor,
          recalculatedNotes: "Correção de cadastro conferida contra o PDF original da guia.",
        } });
      }
      await tx.appSetting.create({ data: { key: `guide_value_correction:${randomUUID()}`, value: {
        companyId, guideId, userId, valorAnterior: previa.valorAtual, valorCorrigido: previa.novoValor,
        revisao, em: new Date().toISOString(), lancamentos: atual.g.accountingEntries.map(e => e.id), pdfPreservado: true,
      } } });
      return { ok: true, guideId, valor: previa.novoValor, lancamentosAfetados: atual.g.accountingEntries.length };
    }, { isolationLevel: "Serializable" });
  } catch (e) {
    if (e.code === "P2034") recusar("guia_alterada", "Houve uma alteração simultânea. Abra uma nova prévia.");
    throw e;
  }
}
