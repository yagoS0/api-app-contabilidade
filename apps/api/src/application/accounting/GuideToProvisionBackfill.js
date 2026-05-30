// Backfill: roda 1x no startup. Procura Guides PROCESSED que ainda não geraram AccountingEntry
// (DARFs e similares — INSS e SIMPLES são pulados pelo service) e chama generateProvisionsFromGuide.
// Cap em 500 por execução (safety). Não falha o boot da API se algum guide der erro.

import { prisma } from "../../infrastructure/db/prisma.js";
import { generateProvisionsFromGuide } from "./GuideToProvisionService.js";

const SUPPORTED_TIPOS = ["DARF", "PIS", "COFINS", "IRPJ", "CSLL", "ISS"];
const SAFETY_CAP = 500;

export async function backfillProvisionsFromExistingGuides({ logger } = {}) {
  const log = logger || console;
  let orphans = [];
  try {
    orphans = await prisma.guide.findMany({
      where: {
        status: "PROCESSED",
        portalClientId: { not: null },
        competencia: { not: null },
        tipo: { in: SUPPORTED_TIPOS },
        accountingEntries: { none: {} },
      },
      select: { id: true, tipo: true, competencia: true, portalClientId: true },
      take: SAFETY_CAP,
      orderBy: { updatedAt: "desc" },
    });
  } catch (err) {
    log.warn?.({ err: err?.message || String(err) }, "Backfill: erro listando guias órfãs");
    return { scanned: 0, ok: 0, fail: 0, error: err?.message };
  }

  if (orphans.length === 0) {
    return { scanned: 0, ok: 0, fail: 0 };
  }

  let ok = 0;
  let fail = 0;
  for (const g of orphans) {
    try {
      const r = await generateProvisionsFromGuide({ guideId: g.id });
      if (r?.ok) ok++;
      else fail++;
    } catch (err) {
      fail++;
      log.warn?.({ err: err?.message || String(err), guideId: g.id, tipo: g.tipo, competencia: g.competencia }, "Backfill: falha em guia");
    }
  }
  log.info?.({ scanned: orphans.length, ok, fail }, "Backfill GuideToProvision concluído");
  return { scanned: orphans.length, ok, fail };
}
