-- CreateTable
CREATE TABLE "accounting_historicos" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "companyPortalClientId" TEXT,
    "text" TEXT NOT NULL,
    "contaDebito" TEXT,
    "contaCredito" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "accounting_historicos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_historicos_createdByUserId_companyPortalClientId_idx" ON "accounting_historicos"("createdByUserId", "companyPortalClientId");

-- CreateIndex
CREATE INDEX "accounting_historicos_createdByUserId_contaDebito_idx" ON "accounting_historicos"("createdByUserId", "contaDebito");

-- CreateIndex
CREATE INDEX "accounting_historicos_createdByUserId_contaCredito_idx" ON "accounting_historicos"("createdByUserId", "contaCredito");
