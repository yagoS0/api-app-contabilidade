-- AlterTable
ALTER TABLE "Guide" ADD COLUMN     "valorOriginal" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "accounting_historicos" ADD COLUMN     "eventType" TEXT;

-- CreateIndex
CREATE INDEX "accounting_historicos_companyPortalClientId_eventType_idx" ON "accounting_historicos"("companyPortalClientId", "eventType");
