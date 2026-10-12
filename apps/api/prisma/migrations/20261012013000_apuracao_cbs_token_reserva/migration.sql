CREATE TABLE "ApuracaoCbsTokenEmissao" (
  "id" TEXT NOT NULL,
  "credencialId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApuracaoCbsTokenEmissao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cbs_token_emissao_credencial" CHECK (length("credencialId") BETWEEN 1 AND 100)
);
CREATE INDEX "cbs_token_emissao_janela_idx" ON "ApuracaoCbsTokenEmissao"("credencialId", "createdAt");
CREATE TRIGGER cbs_token_emissao_preservar BEFORE UPDATE OR DELETE ON "ApuracaoCbsTokenEmissao"
 FOR EACH ROW EXECUTE FUNCTION consumo_mensal_local_imutavel();
