-- SOMENTE LEITURA. Execute antes de qualquer saneamento de histórico legado.
-- Uma associação documental é evidência por mensagem, nunca autoriza mover o fio inteiro.
SELECT "providerMessageId", count(*) AS envios
FROM "envios_guia" WHERE "canal"='WHATSAPP' AND "providerMessageId" IS NOT NULL
GROUP BY "providerMessageId" HAVING count(*)>1;

SELECT c."id" AS conversa_id, c."portalClientId" AS empresa_observada,
       count(m."id") AS mensagens, count(m."envioGuiaId") AS mensagens_com_guia,
       array_remove(array_agg(DISTINCT g."portalClientId"), NULL) AS empresas_documentadas,
       count(m."id") FILTER (WHERE m."envioGuiaId" IS NULL) AS sem_evidencia_documental,
       count(m."id") FILTER (WHERE g."portalClientId" IS DISTINCT FROM c."portalClientId" AND g."portalClientId" IS NOT NULL) AS guias_de_outra_empresa
FROM "conversas_whatsapp" c
LEFT JOIN "mensagens_whatsapp" m ON m."conversaId"=c."id"
LEFT JOIN "envios_guia" e ON e."id"=m."envioGuiaId"
LEFT JOIN "Guide" g ON g."id"=e."guideId"
GROUP BY c."id", c."portalClientId" ORDER BY c."id";

SELECT c."id" AS conversa_id, count(DISTINCT t."portalClientId") AS empresas_candidatas,
       array_remove(array_agg(DISTINCT t."portalClientId"), NULL) AS candidatas
FROM "conversas_whatsapp" c
LEFT JOIN "contatos_whatsapp" t ON t."ativo" AND (t."telefoneE164"=c."telefoneE164" OR t."waId"=c."telefoneE164")
GROUP BY c."id" ORDER BY c."id";
