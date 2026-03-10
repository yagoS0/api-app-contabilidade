CREATE TABLE IF NOT EXISTS "Guide" (
  "id" TEXT PRIMARY KEY,
  "portalClientId" TEXT,
  "legacyCompanyId" TEXT,
  "competencia" TEXT,
  "tipo" TEXT NOT NULL,
  "valor" DECIMAL(18,2),
  "vencimento" TIMESTAMP(3),
  "cnpj" TEXT,
  "source" TEXT NOT NULL DEFAULT 'DRIVE',
  "sourceFileId" TEXT,
  "sourcePath" TEXT,
  "driveInboxFolderId" TEXT,
  "driveFinalFolderId" TEXT,
  "driveFinalFileId" TEXT,
  "storageProvider" TEXT,
  "storageKey" TEXT,
  "storageUrl" TEXT,
  "hash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "errors" JSONB,
  "extracted" JSONB,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Guide_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Guide_legacyCompanyId_fkey"
    FOREIGN KEY ("legacyCompanyId") REFERENCES "Company"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Guide_sourceFileId_key" ON "Guide" ("sourceFileId");
CREATE UNIQUE INDEX IF NOT EXISTS "Guide_hash_key" ON "Guide" ("hash");
CREATE INDEX IF NOT EXISTS "Guide_portalClientId_competencia_tipo_idx"
  ON "Guide" ("portalClientId", "competencia", "tipo");
CREATE INDEX IF NOT EXISTS "Guide_status_idx" ON "Guide" ("status");
CREATE INDEX IF NOT EXISTS "Guide_cnpj_competencia_idx" ON "Guide" ("cnpj", "competencia");

CREATE TABLE IF NOT EXISTS "GuideIngestionJob" (
  "id" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL DEFAULT 'DRIVE',
  "sourceFileId" TEXT NOT NULL,
  "sourceName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "errorReason" TEXT,
  "parserPayload" JSONB,
  "createdGuideId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "GuideIngestionJob_sourceFileId_key"
  ON "GuideIngestionJob" ("sourceFileId");
CREATE INDEX IF NOT EXISTS "GuideIngestionJob_status_updatedAt_idx"
  ON "GuideIngestionJob" ("status", "updatedAt");

CREATE TABLE IF NOT EXISTS "GuideIngestionLock" (
  "id" TEXT PRIMARY KEY,
  "lockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

