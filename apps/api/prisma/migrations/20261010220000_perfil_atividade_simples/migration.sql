ALTER TABLE "perfis_emissao_nfse" ADD COLUMN "cAtvSN" TEXT;
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfis_emissao_nfse_cAtvSN_check"
CHECK ("cAtvSN" IS NULL OR "cAtvSN" IN ('07','08','09','10','11','12','13','14','90'));
