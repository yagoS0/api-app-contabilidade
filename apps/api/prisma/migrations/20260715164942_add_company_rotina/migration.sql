-- CreateTable
CREATE TABLE "company_rotinas" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "rotina" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_rotinas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_rotinas_rotina_enabled_idx" ON "company_rotinas"("rotina", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "company_rotinas_portalClientId_rotina_key" ON "company_rotinas"("portalClientId", "rotina");

-- AddForeignKey
ALTER TABLE "company_rotinas" ADD CONSTRAINT "company_rotinas_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;