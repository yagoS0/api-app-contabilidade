ALTER TABLE "perfis_emissao_nfse" ADD COLUMN "categoriaObrigacaoIbscbs" TEXT;
ALTER TABLE "perfis_emissao_nfse" ADD CONSTRAINT "perfil_categoria_obrigacao_ibscbs_check"
  CHECK ("categoriaObrigacaoIbscbs" IS NULL OR "categoriaObrigacaoIbscbs" IN ('SERVICO_ISS', 'PLATAFORMA_DIGITAL'));
