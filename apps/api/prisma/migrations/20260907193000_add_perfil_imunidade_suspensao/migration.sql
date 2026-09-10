ALTER TABLE "perfis_emissao_nfse"
  ADD COLUMN "tpImunidade" TEXT,
  ADD COLUMN "exigSuspTipo" TEXT,
  ADD COLUMN "exigSuspProcesso" TEXT;

ALTER TABLE "perfis_emissao_nfse"
  ADD CONSTRAINT "perfil_tp_imunidade_forma" CHECK ("tpImunidade" IS NULL OR "tpImunidade" IN ('0','1','2','3','4','5')),
  ADD CONSTRAINT "perfil_exig_susp_tipo_forma" CHECK ("exigSuspTipo" IS NULL OR "exigSuspTipo" IN ('1','2')),
  ADD CONSTRAINT "perfil_exig_susp_processo_forma" CHECK ("exigSuspProcesso" IS NULL OR "exigSuspProcesso" ~ '^[0-9]{30}$');
