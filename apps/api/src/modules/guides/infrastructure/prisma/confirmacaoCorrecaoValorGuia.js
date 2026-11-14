import { randomUUID } from "node:crypto";
import { CorrecaoValorError } from "../../application/preverCorrecaoValorGuia.js";

export async function emTransacaoSerializable(db, executar) {
  try {
    return await db.$transaction(executar, { isolationLevel: "Serializable" });
  } catch (erro) {
    if (erro.code === "P2034") {
      throw new CorrecaoValorError("guia_alterada", "Houve uma alteração simultânea. Abra uma nova prévia.");
    }
    throw erro;
  }
}

export async function atualizarValorGuia(tx, { guideId, companyId, updatedAt, novoValor, leitura, userId }) {
  const resultado = await tx.guide.updateMany({
    where: { id: guideId, portalClientId: companyId, updatedAt },
    data: { valor: novoValor, ...leitura, reviewedByUserId: userId, reviewedAt: new Date() },
  });
  return resultado.count;
}

export function registrarAuditoriaCorrecao(tx, value) {
  return tx.appSetting.create({ data: { key: `guide_value_correction:${randomUUID()}`, value } });
}
