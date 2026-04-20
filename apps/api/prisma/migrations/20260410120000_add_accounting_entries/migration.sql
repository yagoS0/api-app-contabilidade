-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "natureza" TEXT NOT NULL DEFAULT 'DEVEDORA',
    "status" TEXT NOT NULL DEFAULT 'CONFIRMADA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_entries" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "competencia" TEXT NOT NULL,
    "contaDebito" TEXT NOT NULL,
    "contaCredito" TEXT NOT NULL,
    "historico" TEXT NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'DESPESA',
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "loteImportacao" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_portalClientId_codigo_key" ON "chart_of_accounts"("portalClientId", "codigo");

-- CreateIndex
CREATE INDEX "chart_of_accounts_portalClientId_idx" ON "chart_of_accounts"("portalClientId");

-- CreateIndex
CREATE INDEX "chart_of_accounts_portalClientId_status_idx" ON "chart_of_accounts"("portalClientId", "status");

-- CreateIndex
CREATE INDEX "accounting_entries_portalClientId_idx" ON "accounting_entries"("portalClientId");

-- CreateIndex
CREATE INDEX "accounting_entries_portalClientId_competencia_idx" ON "accounting_entries"("portalClientId", "competencia");

-- CreateIndex
CREATE INDEX "accounting_entries_portalClientId_tipo_idx" ON "accounting_entries"("portalClientId", "tipo");

-- CreateIndex
CREATE INDEX "accounting_entries_portalClientId_status_idx" ON "accounting_entries"("portalClientId", "status");

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
