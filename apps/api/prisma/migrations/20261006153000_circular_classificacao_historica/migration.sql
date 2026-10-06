-- Correção autorizada dos registros antigos, sem alterar valores, contas ou pagamentos.
-- O estado anterior permanece no banco para auditoria e reversão.
BEGIN;

CREATE TABLE "circular_classificacao_reparos" (
  "entryId" TEXT PRIMARY KEY,
  "subtipoAnterior" TEXT,
  "subtipoNovo" TEXT NOT NULL,
  "registroAnterior" JSONB NOT NULL,
  "corrigidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Impede alterações concorrentes entre o snapshot e a atualização.
LOCK TABLE "accounting_entries" IN SHARE ROW EXCLUSIVE MODE;

WITH candidatos AS (
  SELECT e.*, CASE
    WHEN e."subtipo" = 'PIS_COFINS' AND e."eventType" = 'DARF_PIS' THEN 'PIS'
    WHEN e."subtipo" = 'PIS_COFINS' AND e."eventType" = 'DARF_COFINS' THEN 'COFINS'
    WHEN e."tipo" = 'BAIXA' AND (e."subtipo" IS NULL OR e."subtipo" IN ('', 'PIS_COFINS')) THEN
      CASE
        WHEN e."eventType" IN ('BAIXA_DARF_PIS', 'BAIXA_PIS') THEN 'PIS'
        WHEN e."eventType" IN ('BAIXA_DARF_COFINS', 'BAIXA_COFINS') THEN 'COFINS'
        WHEN e."eventType" IN ('BAIXA_DARF_IRPJ', 'BAIXA_IRPJ') THEN 'IRPJ'
        WHEN e."eventType" IN ('BAIXA_DARF_CSLL', 'BAIXA_CSLL') THEN 'CSLL'
        WHEN p."subtipo" IN ('PIS', 'COFINS', 'IRPJ', 'CSLL') THEN p."subtipo"
        WHEN p."subtipo" = 'PIS_COFINS' AND p."eventType" = 'DARF_PIS' THEN 'PIS'
        WHEN p."subtipo" = 'PIS_COFINS' AND p."eventType" = 'DARF_COFINS' THEN 'COFINS'
      END
  END AS destino
  FROM "accounting_entries" e
  LEFT JOIN "accounting_entries" p ON p.id = e."openEntryId" AND p."portalClientId" = e."portalClientId"
)
INSERT INTO "circular_classificacao_reparos" ("entryId", "subtipoAnterior", "subtipoNovo", "registroAnterior")
SELECT id, subtipo, destino, to_jsonb(candidatos) - 'destino'
FROM candidatos WHERE destino IS NOT NULL AND subtipo IS DISTINCT FROM destino;

UPDATE "accounting_entries" e
SET "subtipo" = r."subtipoNovo", "updatedAt" = CURRENT_TIMESTAMP
FROM "circular_classificacao_reparos" r WHERE e.id = r."entryId";

COMMIT;
