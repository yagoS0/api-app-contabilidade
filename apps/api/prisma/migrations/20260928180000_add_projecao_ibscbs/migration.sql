-- Projeção reconstruível do XML. Nulo significa ainda não processado.
ALTER TABLE "PortalInvoice" ADD COLUMN "ibscbs" JSONB;
ALTER TABLE "ServiceInvoice" ADD COLUMN "ibscbs" JSONB;
ALTER TABLE "ServiceInvoice" ADD COLUMN "pedidoXml" TEXT, ADD COLUMN "contextoFiscal" JSONB;
ALTER TABLE "nota_itens" ADD COLUMN "ibscbs" JSONB;
ALTER TABLE "perfis_emissao_nfse" ADD COLUMN "ibscbsCategoriaOperacao" TEXT;
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfis_emissao_nfse_ibscbs_categoria_check"
  CHECK ("ibscbsCategoriaOperacao" IN ('SERVICO_ISS', 'PLATAFORMA', 'OUTROS'));
