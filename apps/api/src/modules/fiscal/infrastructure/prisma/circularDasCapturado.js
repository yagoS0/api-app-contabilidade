import { prisma } from "../../../../infrastructure/db/prisma.js";
import { gravarAcrescimoCircular } from "../../../../application/fiscal/circularAcrescimos.js";

export function lerCircularDasCapturado({ portalClientId, competencia }) {
  return prisma.companyMonthlyCircular.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
}

export function gravarCircularDasCapturado({
  portalClient, normalizedCompetencia, mapped, resolvedServiceId, procuradorCnpj, now,
}) {
  return prisma.companyMonthlyCircular.upsert({
    where: {
      portalClientId_competencia: {
        portalClientId: portalClient.id,
        competencia: normalizedCompetencia,
      },
    },
    create: {
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      receitaBruta: mapped.parsed.receitaBruta != null ? mapped.parsed.receitaBruta : null,
      dasTotal: mapped.parsed.valor != null ? mapped.parsed.valor : null,
      inssTotal: mapped.parsed.inssTotal != null ? mapped.parsed.inssTotal : null,
      metadata: {
        integrationSource: "SERPRO_PGDASD",
        sistema: "PGDASD",
        servico: resolvedServiceId,
        numeroDocumento: mapped.numeroDocumento,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        referencia: normalizedCompetencia,
        rawPayload: mapped.rawPayload,
        capturedAt: now.toISOString(),
      },
    },
    update: {
      ...(mapped.parsed.receitaBruta != null ? { receitaBruta: mapped.parsed.receitaBruta } : {}),
      ...(mapped.parsed.valor != null ? { dasTotal: mapped.parsed.valor } : {}),
      ...(mapped.parsed.inssTotal != null ? { inssTotal: mapped.parsed.inssTotal } : {}),
      metadata: {
        integrationSource: "SERPRO_PGDASD",
        sistema: "PGDASD",
        servico: resolvedServiceId,
        numeroDocumento: mapped.numeroDocumento,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        referencia: normalizedCompetencia,
        rawPayload: mapped.rawPayload,
        capturedAt: now.toISOString(),
      },
    },
  });
}

// Campos fiscais capturados; a composição fornece esta capacidade à coordenação contábil.
export function gravarAcrescimosDasCapturado({ portalClientId, competencia, valores }) {
  return gravarAcrescimoCircular({ client: prisma, portalClientId, competencia, valores });
}
