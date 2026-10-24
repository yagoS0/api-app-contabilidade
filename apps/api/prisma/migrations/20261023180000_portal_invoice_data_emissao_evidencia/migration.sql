ALTER TABLE "PortalInvoice" ADD COLUMN "dataEmissaoCivil" VARCHAR(10), ADD COLUMN "dataEmissaoInstante" TIMESTAMP(3), ADD COLUMN "dataEmissaoEvidencia" JSONB, ADD COLUMN "xmlResumo" TEXT;
CREATE INDEX "PortalInvoice_clientId_dataEmissaoCivil_idx" ON "PortalInvoice"("clientId", "dataEmissaoCivil");
