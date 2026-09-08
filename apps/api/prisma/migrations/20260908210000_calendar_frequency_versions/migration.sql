-- Preserva histórico; nenhuma ocorrência existente é retirada na migração.
ALTER TABLE "ocorrencias_obrigacao" ADD COLUMN "foraDaRecorrencia" BOOLEAN NOT NULL DEFAULT false;
