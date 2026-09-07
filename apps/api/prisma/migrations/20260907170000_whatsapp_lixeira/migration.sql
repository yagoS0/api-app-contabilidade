BEGIN;
ALTER TABLE "conversas_whatsapp"
  ADD COLUMN "excluidaEm" TIMESTAMP(3),
  ADD COLUMN "automacaoInvalidadaEm" TIMESTAMP(3);
COMMIT;
