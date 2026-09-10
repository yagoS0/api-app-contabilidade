-- Sem exclusão/backfill especulativo: ciclos legados são identificados durante a sincronização.
ALTER TABLE "obrigacoes" ADD COLUMN "janelaTrabalho" JSONB,
 ADD COLUMN "agendaVersoes" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "encerradaAPartirDe" TEXT;
ALTER TABLE "ocorrencias_obrigacao" ADD COLUMN "cicloChave" TEXT,
 ADD COLUMN "canceladaEm" TIMESTAMP(3), ADD COLUMN "canceladaPorId" TEXT;
CREATE UNIQUE INDEX "ocorrencias_obrigacao_obrigacaoId_cicloChave_key"
 ON "ocorrencias_obrigacao"("obrigacaoId", "cicloChave");
