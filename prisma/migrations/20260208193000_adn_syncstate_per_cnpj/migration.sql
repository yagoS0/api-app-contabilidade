-- Move ADN sync state from global (single row) to per-CNPJ
-- This prevents one company from "consuming" the NSU of another.

-- Keep old global NSU (if any)
CREATE TEMP TABLE "_AdnSyncState_old" AS
SELECT COALESCE(MAX("ultimoNSU"), 0) AS "ultimoNSU" FROM "AdnSyncState";

DROP TABLE IF EXISTS "AdnSyncState";

CREATE TABLE "AdnSyncState" (
  "cnpj" TEXT PRIMARY KEY,
  "ultimoNSU" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Align with Prisma @updatedAt expectations
ALTER TABLE "AdnSyncState"
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- Seed state for existing companies using the previous global NSU
INSERT INTO "AdnSyncState" ("cnpj", "ultimoNSU", "updatedAt")
SELECT
  regexp_replace("cnpj", '\\D', '', 'g') AS "cnpj",
  (SELECT "ultimoNSU" FROM "_AdnSyncState_old" LIMIT 1) AS "ultimoNSU",
  CURRENT_TIMESTAMP
FROM "Company"
WHERE "cnpj" IS NOT NULL
  AND regexp_replace("cnpj", '\\D', '', 'g') <> ''
ON CONFLICT ("cnpj") DO NOTHING;

DROP TABLE "_AdnSyncState_old";

