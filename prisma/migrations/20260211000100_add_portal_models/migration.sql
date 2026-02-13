-- Portal models: clients, sync state, invoices, events, sync jobs

CREATE TABLE IF NOT EXISTS "PortalClient" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT UNIQUE,
  "razao" TEXT NOT NULL,
  "cnpj" TEXT NOT NULL UNIQUE,
  "inscricaoMunicipal" TEXT,
  "uf" TEXT,
  "municipio" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "PortalClient_cnpj_idx" ON "PortalClient" ("cnpj");
CREATE INDEX IF NOT EXISTS "PortalClient_updatedAt_idx" ON "PortalClient" ("updatedAt");

CREATE TABLE IF NOT EXISTS "PortalIntegrationSettings" (
  "id" TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL UNIQUE,
  "provider" TEXT NOT NULL DEFAULT 'NFSENACIONAL',
  "environment" TEXT NOT NULL DEFAULT 'PROD',
  "certCompanyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortalIntegrationSettings_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PortalSyncState" (
  "clientId" TEXT PRIMARY KEY,
  "lastCursor" BIGINT NOT NULL DEFAULT 0,
  "lastSyncAt" TIMESTAMP(3),
  "state" TEXT NOT NULL DEFAULT 'OK',
  "lastError" TEXT,
  "lockUntil" TIMESTAMP(3),
  "backoffUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortalSyncState_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PortalSyncState_state_idx" ON "PortalSyncState" ("state");
CREATE INDEX IF NOT EXISTS "PortalSyncState_lockUntil_idx" ON "PortalSyncState" ("lockUntil");
CREATE INDEX IF NOT EXISTS "PortalSyncState_backoffUntil_idx" ON "PortalSyncState" ("backoffUntil");

CREATE TABLE IF NOT EXISTS "PortalInvoice" (
  "id" TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "numero" TEXT,
  "serie" TEXT,
  "chaveAcesso" TEXT,
  "idNfse" TEXT,
  "idDps" TEXT,
  "competencia" TIMESTAMP(3),
  "issueDate" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDENTE',
  "total" NUMERIC(18,2),
  "emitenteNome" TEXT,
  "emitenteDoc" TEXT,
  "tomadorNome" TEXT,
  "tomadorDoc" TEXT,
  "xmlRaw" TEXT,
  "pdfUrl" TEXT,
  "xmlHash" TEXT,
  "lastSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortalInvoice_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PortalInvoice_clientId_idx" ON "PortalInvoice" ("clientId");
CREATE INDEX IF NOT EXISTS "PortalInvoice_clientId_updatedAt_idx" ON "PortalInvoice" ("clientId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "PortalInvoice_clientId_competencia_status_updatedAt_idx"
  ON "PortalInvoice" ("clientId", "competencia", "status", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "PortalInvoice_clientId_issueDate_idx" ON "PortalInvoice" ("clientId", "issueDate" DESC);
CREATE INDEX IF NOT EXISTS "PortalInvoice_status_updatedAt_idx" ON "PortalInvoice" ("status", "updatedAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "PortalInvoice_clientId_chaveAcesso_key"
  ON "PortalInvoice" ("clientId", "chaveAcesso");
CREATE UNIQUE INDEX IF NOT EXISTS "PortalInvoice_clientId_idDps_key"
  ON "PortalInvoice" ("clientId", "idDps");
CREATE UNIQUE INDEX IF NOT EXISTS "PortalInvoice_clientId_idNfse_key"
  ON "PortalInvoice" ("clientId", "idNfse");

CREATE TABLE IF NOT EXISTS "PortalInvoiceEvent" (
  "id" TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "date" TIMESTAMP(3),
  "protocol" TEXT,
  "reason" TEXT,
  "payloadRaw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalInvoiceEvent_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PortalInvoiceEvent_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "PortalInvoice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PortalInvoiceEvent_clientId_idx" ON "PortalInvoiceEvent" ("clientId");
CREATE INDEX IF NOT EXISTS "PortalInvoiceEvent_invoiceId_date_idx" ON "PortalInvoiceEvent" ("invoiceId", "date" DESC);

CREATE TABLE IF NOT EXISTS "PortalInvoiceSyncJob" (
  "id" TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'RUNNING',
  "processed" INTEGER NOT NULL DEFAULT 0,
  "created" INTEGER NOT NULL DEFAULT 0,
  "updated" INTEGER NOT NULL DEFAULT 0,
  "duplicates" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "lastCursor" BIGINT,
  "lastMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortalInvoiceSyncJob_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PortalInvoiceSyncJob_clientId_createdAt_idx"
  ON "PortalInvoiceSyncJob" ("clientId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "PortalInvoiceSyncJob_state_idx" ON "PortalInvoiceSyncJob" ("state");

