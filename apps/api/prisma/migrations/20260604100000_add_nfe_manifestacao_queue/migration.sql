-- Q12.B+++.8.a: fila de eventos de Manifestação do Destinatário (NF-e).
-- Aditivo (CREATE TABLE). Idempotente por (clientId, chaveAcesso, tpEvento).

CREATE TABLE "NfeManifestacaoQueue" (
  "id"             TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "chaveAcesso"    TEXT NOT NULL,
  "tpEvento"       TEXT NOT NULL,
  "nSeqEvento"     INTEGER NOT NULL DEFAULT 1,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "lastError"      TEXT,
  "lastResponse"   TEXT,
  "protocoloSefaz" TEXT,
  "cStat"          TEXT,
  "xMotivo"        TEXT,
  "sentAt"         TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NfeManifestacaoQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NfeManifestacaoQueue_clientId_chaveAcesso_tpEvento_key"
  ON "NfeManifestacaoQueue"("clientId", "chaveAcesso", "tpEvento");

CREATE INDEX "NfeManifestacaoQueue_status_createdAt_idx"
  ON "NfeManifestacaoQueue"("status", "createdAt");

CREATE INDEX "NfeManifestacaoQueue_clientId_status_idx"
  ON "NfeManifestacaoQueue"("clientId", "status");

ALTER TABLE "NfeManifestacaoQueue"
  ADD CONSTRAINT "NfeManifestacaoQueue_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "PortalClient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
