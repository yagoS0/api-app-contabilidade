BEGIN;
ALTER TABLE "contatos_whatsapp"
  ADD COLUMN "permissoesAssistente" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
COMMIT;
