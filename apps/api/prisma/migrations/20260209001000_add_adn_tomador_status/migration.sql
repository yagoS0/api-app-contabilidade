-- Add tomador/prestador names and normalized status for ADN documents

ALTER TABLE "AdnDocument"
  ADD COLUMN IF NOT EXISTS "status" TEXT,
  ADD COLUMN IF NOT EXISTS "prestadorNome" TEXT,
  ADD COLUMN IF NOT EXISTS "tomadorNome" TEXT;

CREATE INDEX IF NOT EXISTS "AdnDocument_status_idx" ON "AdnDocument" ("status");

