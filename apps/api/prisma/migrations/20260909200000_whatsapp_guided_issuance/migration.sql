ALTER TABLE "acoes_pendentes_whatsapp"
  ADD COLUMN "respostaAoCliente" TEXT,
  ADD COLUMN "encaminharHumano" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "rascunhos_emissao_whatsapp" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversaId" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "corteAutomacao" TIMESTAMP(3),
  "estado" JSONB NOT NULL,
  "versao" INTEGER NOT NULL DEFAULT 1 CHECK ("versao" > 0),
  "ultimaMensagemEm" TIMESTAMP(3) NOT NULL,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rascunhos_emissao_whatsapp_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas_whatsapp"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "rascunhos_emissao_whatsapp_conversaId_key" ON "rascunhos_emissao_whatsapp"("conversaId");
CREATE INDEX "rascunhos_emissao_whatsapp_portalClientId_idx" ON "rascunhos_emissao_whatsapp"("portalClientId");
CREATE INDEX "rascunhos_emissao_whatsapp_expiraEm_idx" ON "rascunhos_emissao_whatsapp"("expiraEm");

CREATE TABLE "etapas_emissao_whatsapp" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "mensagemId" TEXT NOT NULL,
  "conversaId" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "resultado" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "etapas_emissao_whatsapp_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas_whatsapp"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "etapas_emissao_whatsapp_mensagemId_key" ON "etapas_emissao_whatsapp"("mensagemId");
CREATE INDEX "etapas_emissao_whatsapp_conversaId_createdAt_idx" ON "etapas_emissao_whatsapp"("conversaId", "createdAt");
