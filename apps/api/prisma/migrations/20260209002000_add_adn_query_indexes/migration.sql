-- Indexes to keep /api/notas fast (PostgreSQL)

CREATE INDEX IF NOT EXISTS "AdnDocument_competencia_status_updatedAt_idx"
  ON "AdnDocument" ("competencia", "status", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "AdnDocument_status_updatedAt_idx"
  ON "AdnDocument" ("status", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "AdnDocument_dataEmissao_status_idx"
  ON "AdnDocument" ("dataEmissao", "status");

