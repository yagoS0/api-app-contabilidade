-- DropIndex
DROP INDEX "AdnDocument_competencia_status_updatedAt_idx";

-- DropIndex
DROP INDEX "AdnDocument_status_updatedAt_idx";

-- DropIndex
DROP INDEX "PortalInvoice_clientId_competencia_status_updatedAt_idx";

-- DropIndex
DROP INDEX "PortalInvoice_clientId_issueDate_idx";

-- DropIndex
DROP INDEX "PortalInvoice_clientId_updatedAt_idx";

-- DropIndex
DROP INDEX "PortalInvoice_status_updatedAt_idx";

-- DropIndex
DROP INDEX "PortalInvoiceEvent_invoiceId_date_idx";

-- DropIndex
DROP INDEX "PortalInvoiceSyncJob_clientId_createdAt_idx";

-- DropIndex
DROP INDEX "User_accountType_idx";

-- AlterTable
ALTER TABLE "AdnDocument" ALTER COLUMN "dataHoraGeracao" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "dataEmissao" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "competencia" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "accounting_historicos" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AdnDocument_competencia_status_updatedAt_idx" ON "AdnDocument"("competencia", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AdnDocument_status_updatedAt_idx" ON "AdnDocument"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "PortalInvoice_clientId_updatedAt_idx" ON "PortalInvoice"("clientId", "updatedAt");

-- CreateIndex
CREATE INDEX "PortalInvoice_clientId_competencia_status_updatedAt_idx" ON "PortalInvoice"("clientId", "competencia", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "PortalInvoice_clientId_issueDate_idx" ON "PortalInvoice"("clientId", "issueDate");

-- CreateIndex
CREATE INDEX "PortalInvoice_status_updatedAt_idx" ON "PortalInvoice"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "PortalInvoiceEvent_invoiceId_date_idx" ON "PortalInvoiceEvent"("invoiceId", "date");

-- CreateIndex
CREATE INDEX "PortalInvoiceSyncJob_clientId_createdAt_idx" ON "PortalInvoiceSyncJob"("clientId", "createdAt");
