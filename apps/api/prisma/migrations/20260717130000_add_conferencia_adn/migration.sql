-- Robustez NFS-e/ADN — Camada 2: conferência de contagem por chave contra o ADN antes do fechamento.
-- Aditivo (ADD COLUMN). Grava o resultado da conferência no snapshot pra o salvarFechamento poder travar.

ALTER TABLE "apuracao_snapshots" ADD COLUMN "conferenciaStatus" TEXT;
ALTER TABLE "apuracao_snapshots" ADD COLUMN "conferenciaResultado" JSONB;
ALTER TABLE "apuracao_snapshots" ADD COLUMN "conferidaEm" TIMESTAMP(3);
