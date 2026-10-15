import { prisma } from "../../infrastructure/db/prisma.js";
import { generateProvisionsFromGuide } from "./GuideToProvisionService.js";

const erro = (message, code, status) => Object.assign(new Error(message), { code, status });

export async function listarGuiasPendentesContabilizacao({ portalClientId, competencia }, db = prisma) {
  return db.guide.findMany({
    where: { portalClientId, competencia, status: "PROCESSED", parcelamentoId: null,
      extracted: { path: ["contabilizacaoPendente", "motivo"], equals: "MES_FECHADO" } },
    select: { id: true, tipo: true, competencia: true, valor: true, sourcePath: true, updatedAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function contabilizarGuiaPendente({ portalClientId, guideId, updatedAt }, db = prisma) {
  if (!updatedAt || Number.isNaN(new Date(updatedAt).getTime())) throw erro("Recarregue a lista de guias pendentes.", "REVISAO_OBRIGATORIA", 400);
  return db.$transaction(async tx => {
    const guia = await tx.guide.findFirst({ where: { id: guideId, portalClientId, status: "PROCESSED", parcelamentoId: null } });
    if (!guia) throw erro("Guia não encontrada nesta empresa.", "GUIA_NAO_ENCONTRADA", 404);
    if (!guia.extracted?.contabilizacaoPendente) return { ok: true, jaContabilizada: true };
    if (new Date(guia.updatedAt).getTime() !== new Date(updatedAt).getTime()) throw erro("A guia mudou. Recarregue a lista antes de contabilizar.", "GUIA_ALTERADA", 409);
    const circular = await tx.companyMonthlyCircular.findUnique({
      where: { portalClientId_competencia: { portalClientId, competencia: guia.competencia } },
      select: { fechadoContabilEm: true },
    });
    if (circular?.fechadoContabilEm) throw erro("Reabra o mês antes de contabilizar esta guia.", "MES_FECHADO", 409);
    const resultado = await generateProvisionsFromGuide({ guideId: guia.id, tx });
    if (!resultado.ok || resultado.skipped || !resultado.entries?.length) throw erro("A guia precisa de conferência manual para gerar provisões.", "GUIA_SEM_PROVISAO", 409);
    if (resultado.entries.some(entry => entry.action === "skipped_exported")) throw erro("Há lançamentos exportados desta guia. Confira a contabilidade antes de atualizar as provisões.", "GUIA_LANCAMENTO_EXPORTADO", 409);
    const { contabilizacaoPendente, ...extracted } = guia.extracted;
    const alterada = await tx.guide.updateMany({ where: { id: guia.id, portalClientId, updatedAt: guia.updatedAt }, data: { extracted } });
    if (alterada.count !== 1) throw erro("A guia mudou durante a contabilização. Recarregue a lista.", "GUIA_ALTERADA", 409);
    return { ok: true, lancamentos: resultado.entries.length };
  }, { isolationLevel: "Serializable" });
}
