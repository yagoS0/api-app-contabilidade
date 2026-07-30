// Escopo multi-tenant das rotas de escritório: quais empresas este usuário enxerga.
//
// Mesmo critério do `GET /companies/annual`: admin e contador enxergam a carteira toda; os demais,
// só as empresas com acesso ATIVO. Estava escrito dentro de `calendario.js` e ia virar cópia
// literal em `obrigacoes.js` — duas cópias de uma regra de ISOLAMENTO é onde elas divergem, e
// divergir aqui significa vazar empresa entre escritórios.

import { prisma } from "../../infrastructure/db/prisma.js";

export async function empresasVisiveis(req) {
  const userId = String(req.auth.user.id);
  const role = String(req.auth.user.role || "").toLowerCase();
  if (role === "admin" || role === "contador") {
    const todas = await prisma.portalClient.findMany({ select: { id: true } });
    return todas.map((p) => p.id);
  }
  const links = await prisma.companyFirmAccess.findMany({
    where: { userId, status: "ACTIVE" },
    select: { companyId: true },
  });
  return links.map((l) => l.companyId).filter(Boolean);
}
