ALTER TABLE "ServiceInvoice" ADD COLUMN "revisaoPeriodoPendente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pendencias_pos_fechamento" ADD COLUMN "chaveEvento" TEXT, ADD COLUMN "serviceInvoiceId" TEXT, ADD COLUMN "origem" TEXT, ADD COLUMN "situacaoPeriodo" TEXT, ADD COLUMN "valor" TEXT, ADD COLUMN "resolucaoMotivo" TEXT;
CREATE UNIQUE INDEX "pendencias_pos_fechamento_chaveEvento_key" ON "pendencias_pos_fechamento"("chaveEvento");
CREATE INDEX "ServiceInvoice_revisaoPeriodoPendente_idx" ON "ServiceInvoice"("revisaoPeriodoPendente") WHERE "revisaoPeriodoPendente" = true;
