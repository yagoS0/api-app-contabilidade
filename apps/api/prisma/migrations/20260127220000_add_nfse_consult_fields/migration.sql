-- Add fields for DPS/NFSe consultation identifiers
ALTER TABLE "ServiceInvoice"
ADD COLUMN "idDps" TEXT,
ADD COLUMN "chaveAcesso" TEXT;

CREATE INDEX "ServiceInvoice_idDps_idx" ON "ServiceInvoice" ("idDps");
CREATE INDEX "ServiceInvoice_chaveAcesso_idx" ON "ServiceInvoice" ("chaveAcesso");
