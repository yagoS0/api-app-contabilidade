-- Add accountType to User and explicit access tables for client/firm portals.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "accountType" TEXT NOT NULL DEFAULT 'CLIENT';

CREATE INDEX IF NOT EXISTS "User_accountType_idx" ON "User" ("accountType");

UPDATE "User"
SET "accountType" = 'FIRM'
WHERE LOWER(COALESCE("role", '')) IN ('admin', 'contador');

CREATE TABLE IF NOT EXISTS "CompanyClientUser" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'CLIENT_USER',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyClientUser_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompanyClientUser_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyClientUser_companyId_userId_key"
  ON "CompanyClientUser" ("companyId", "userId");
CREATE INDEX IF NOT EXISTS "CompanyClientUser_userId_status_idx"
  ON "CompanyClientUser" ("userId", "status");
CREATE INDEX IF NOT EXISTS "CompanyClientUser_companyId_status_idx"
  ON "CompanyClientUser" ("companyId", "status");

CREATE TABLE IF NOT EXISTS "CompanyFirmAccess" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'STAFF',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyFirmAccess_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompanyFirmAccess_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyFirmAccess_companyId_userId_key"
  ON "CompanyFirmAccess" ("companyId", "userId");
CREATE INDEX IF NOT EXISTS "CompanyFirmAccess_userId_status_idx"
  ON "CompanyFirmAccess" ("userId", "status");
CREATE INDEX IF NOT EXISTS "CompanyFirmAccess_companyId_status_idx"
  ON "CompanyFirmAccess" ("companyId", "status");

