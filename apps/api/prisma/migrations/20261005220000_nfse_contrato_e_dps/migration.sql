ALTER TABLE "ServiceInvoice"
  ADD COLUMN "contratoEmissao" TEXT,
  ADD COLUMN "xmlDps" TEXT,
  ADD COLUMN "configuracaoFiscal" JSONB;
