import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/db/prisma.js";

// Agregação no banco, sem limite de página. SQL é necessário para comparar o instante
// da mensagem com lidaAteEm da conversa; os IDs da carteira são parâmetros.
export async function resumoWhatsapp(empresas, { client = prisma } = {}) {
  const carteira = empresas.length
    ? Prisma.sql`c."portalClientId" IN (${Prisma.join(empresas)})`
    : Prisma.sql`FALSE`;
  const fila = Prisma.sql`c."portalClientId" IS NULL AND
    (c."chaveEscopo" LIKE 'sem-empresa:%' OR c."chaveEscopo" LIKE 'legado:sem-empresa:%')`;
  const historico = Prisma.sql`c."portalClientId" IS NOT NULL AND c."chaveEscopo" LIKE 'legado:%'`;
  const operacional = Prisma.sql`c."excluidaEm" IS NULL AND NOT (${historico})`;
  const [r] = await client.$queryRaw(Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE ${operacional})::int AS "conversas",
      COUNT(*) FILTER (WHERE c."excluidaEm" IS NULL AND (${fila}))::int AS "naoVinculadas",
      COUNT(*) FILTER (WHERE novas.total > 0 AND (${operacional}))::int AS "conversasNaoLidas",
      COALESCE(SUM(novas.total) FILTER (WHERE ${operacional}), 0)::int AS "mensagensNaoLidas",
      COUNT(*) FILTER (WHERE c."excluidaEm" IS NULL AND (${historico}))::int AS "historicoConversas",
      COUNT(*) FILTER (WHERE c."excluidaEm" IS NULL AND novas.total > 0 AND (${historico}))::int AS "historicoConversasNaoLidas",
      COALESCE(SUM(novas.total) FILTER (WHERE c."excluidaEm" IS NULL AND (${historico})), 0)::int AS "historicoMensagensNaoLidas",
      COUNT(*) FILTER (WHERE c."excluidaEm" IS NOT NULL)::int AS "lixeiraConversas",
      COUNT(*) FILTER (WHERE c."excluidaEm" IS NOT NULL AND novas.total > 0)::int AS "lixeiraConversasNaoLidas",
      COALESCE(SUM(novas.total) FILTER (WHERE c."excluidaEm" IS NOT NULL), 0)::int AS "lixeiraMensagensNaoLidas"
    FROM conversas_whatsapp c
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total FROM mensagens_whatsapp m
      WHERE m."conversaId" = c.id AND m.direcao = 'in'
        AND (c."lidaAteEm" IS NULL OR m."registradaEm" > c."lidaAteEm")
    ) novas
    WHERE (${carteira} OR (${fila}))
  `);
  return r;
}
