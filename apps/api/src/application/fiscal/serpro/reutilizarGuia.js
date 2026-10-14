import { prisma } from "../../../infrastructure/db/prisma.js";
import { toGuideResponse, PUBLICO } from "../../guides/GuideService.js";
import { whereDasSalvo } from "./pgdasDocumentos.js";
export async function reutilizarGuia({ portalClientId, competencia, tipo }, client = prisma) {
  const guide = await client.guide.findFirst({ where: tipo === "SIMPLES" ? whereDasSalvo(portalClientId, competencia) : { portalClientId, competencia, tipo, source: "SERPRO", status: "PROCESSED", parcelamentoId: null }, orderBy: { updatedAt: "desc" } });
  // Só reutilizar arquivo presente no banco; referência externa não prova disponibilidade.
  if (!guide?.pdfBytes?.length) return null;
  const circular = await client.companyMonthlyCircular.findFirst({ where: { portalClientId, competencia } });
  return { guide: toGuideResponse(guide, { publico: PUBLICO.ESCRITORIO }), circular,
    accounting: { ok: true, generatedEntries: [] }, reutilizado: true,
    integration: { origem: "ARQUIVO_SALVO", chamadaSerpro: false } };
}
