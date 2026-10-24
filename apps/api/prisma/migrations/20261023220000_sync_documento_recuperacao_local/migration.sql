-- Additive recovery ledger. No legacy materialization, cursor change or evidence rewrite.
ALTER TABLE "PortalSyncState" ADD COLUMN "syncDocumentoPendenteId" TEXT;
CREATE TABLE "SyncDocumentoPendente" (
 "id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "origem" TEXT NOT NULL, "nsu" TEXT,
 "snapshot" JSONB NOT NULL, "snapshotHash" TEXT NOT NULL, "hashVersao" TEXT NOT NULL DEFAULT 'sync-json-v1',
 "stateVersion" TEXT NOT NULL, "revisao" INTEGER NOT NULL DEFAULT 1, "estado" TEXT NOT NULL DEFAULT 'ATIVA',
 "motivo" TEXT NOT NULL, "classe" TEXT NOT NULL, "resultado" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvidoEm" TIMESTAMP(3),
 CONSTRAINT "sync_pendente_estado" CHECK ("estado" IN ('ATIVA','RESOLVIDA')),
 CONSTRAINT "sync_pendente_revisao" CHECK ("revisao" > 0)
);
CREATE UNIQUE INDEX "SyncDocumentoPendente_id_clientId_key" ON "SyncDocumentoPendente"("id", "clientId");
CREATE INDEX "SyncDocumentoPendente_clientId_estado_idx" ON "SyncDocumentoPendente"("clientId", "estado");
CREATE UNIQUE INDEX "sync_pendente_ativa_key" ON "SyncDocumentoPendente"("clientId") WHERE "estado" = 'ATIVA';
CREATE TABLE "SyncDocumentoTentativa" (
 "id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "pendenciaId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "motivo" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
 "revisaoSolicitada" TEXT NOT NULL, "hashSolicitado" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "estado" TEXT NOT NULL DEFAULT 'EM_ANDAMENTO', "codigo" TEXT, "httpStatus" INTEGER,
 "resultado" JSONB, "erroSecundario" TEXT, "conflitos" JSONB, "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "concluidaEm" TIMESTAMP(3),
 CONSTRAINT "sync_tentativa_estado" CHECK ("estado" IN ('EM_ANDAMENTO','SUCESSO','REJEITADA')),
 CONSTRAINT "SyncDocumentoTentativa_pendenciaId_clientId_fkey" FOREIGN KEY ("pendenciaId","clientId")
 REFERENCES "SyncDocumentoPendente"("id","clientId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sync_tentativa_idempotencia_key" ON "SyncDocumentoTentativa"("clientId","pendenciaId","idempotencyKey");
CREATE TABLE "SyncDocumentoEntrega" (
 "id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "origem" TEXT NOT NULL, "nsu" TEXT NOT NULL,
 "conteudoHash" TEXT NOT NULL, "chaveAcesso" TEXT, "invoiceId" TEXT NOT NULL, "eventId" TEXT,
 "resultado" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SyncDocumentoEntrega_clientId_origem_nsu_key" ON "SyncDocumentoEntrega"("clientId","origem","nsu");
