CREATE TABLE "pendencias_fiscais_manuais" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "dados" JSONB NOT NULL,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "pendencias_fiscais_manuais_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pendencias_fiscais_manuais_portalClientId_deletedAt_idx" ON "pendencias_fiscais_manuais"("portalClientId", "deletedAt");
ALTER TABLE "pendencias_fiscais_manuais" ADD CONSTRAINT "pendencias_fiscais_manuais_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
