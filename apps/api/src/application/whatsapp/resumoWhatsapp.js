import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/db/prisma.js";

// Agregação no banco, sem limite de página. SQL é necessário para comparar o instante
// da mensagem com lidaAteEm da conversa; os IDs da carteira são parâmetros.
export async function resumoWhatsapp(empresas, { client = prisma } = {}) {
  const carteira = empresas.length
    ? Prisma.sql`c."portalClientId" IN (${Prisma.join(empresas)})`
    : Prisma.sql`FALSE`;
  const [r] = await client.$queryRaw(Prisma.sql`
    SELECT COUNT(*)::int AS "conversas",
      COUNT(*) FILTER (WHERE c."portalClientId" IS NULL)::int AS "naoVinculadas",
      COUNT(*) FILTER (WHERE novas.total > 0)::int AS "conversasNaoLidas",
      COALESCE(SUM(novas.total), 0)::int AS "mensagensNaoLidas"
    FROM conversas_whatsapp c
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total FROM mensagens_whatsapp m
      WHERE m."conversaId" = c.id AND m.direcao = 'in'
        AND (c."lidaAteEm" IS NULL OR m."registradaEm" > c."lidaAteEm")
    ) novas
    WHERE (${carteira} OR c."portalClientId" IS NULL)
  `);
  return r;
}
