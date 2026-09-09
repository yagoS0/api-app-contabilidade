CREATE TABLE "serpro_respostas_cache" (
  "chave" TEXT NOT NULL,
  "resposta" JSONB NOT NULL,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "serpro_respostas_cache_pkey" PRIMARY KEY ("chave")
);
CREATE INDEX "serpro_respostas_cache_expiraEm_idx" ON "serpro_respostas_cache"("expiraEm");
ALTER TABLE "serpro_chamadas" ADD COLUMN "competencia" TEXT, ADD COLUMN "acaoId" TEXT;
