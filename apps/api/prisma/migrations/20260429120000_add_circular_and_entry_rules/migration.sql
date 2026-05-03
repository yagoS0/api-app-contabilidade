-- CreateTable
CREATE TABLE "company_monthly_circulars" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "receitaBruta" DECIMAL(18,2),
    "dasTotal" DECIMAL(18,2),
    "inssTotal" DECIMAL(18,2),
    "metadata" JSONB,
    "hasAccountingDivergence" BOOLEAN NOT NULL DEFAULT false,
    "accountingDivergenceMessage" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "company_monthly_circulars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_entry_rules" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "eventType" TEXT NOT NULL,
    "descriptionTemplate" TEXT NOT NULL,
    "debitAccountCode" TEXT NOT NULL,
    "creditAccountCode" TEXT NOT NULL,
    "amountSource" TEXT NOT NULL,
    "entryDateStrategy" TEXT NOT NULL DEFAULT 'LAST_DAY_OF_MONTH',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "accounting_entry_rules_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "accounting_entries" ADD COLUMN "circularId" TEXT;
ALTER TABLE "accounting_entries" ADD COLUMN "ruleId" TEXT;
ALTER TABLE "accounting_entries" ADD COLUMN "eventType" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "company_monthly_circulars_portalClientId_competencia_key" ON "company_monthly_circulars"("portalClientId", "competencia");

-- CreateIndex
CREATE INDEX "company_monthly_circulars_portalClientId_competencia_idx" ON "company_monthly_circulars"("portalClientId", "competencia");

-- CreateIndex
CREATE INDEX "accounting_entry_rules_portalClientId_eventType_idx" ON "accounting_entry_rules"("portalClientId", "eventType");

-- CreateIndex
CREATE INDEX "accounting_entry_rules_scope_eventType_isActive_idx" ON "accounting_entry_rules"("scope", "eventType", "isActive");

-- CreateIndex
CREATE INDEX "accounting_entry_rules_eventType_isActive_idx" ON "accounting_entry_rules"("eventType", "isActive");

-- CreateIndex
CREATE INDEX "accounting_entries_portalClientId_eventType_idx" ON "accounting_entries"("portalClientId", "eventType");

-- CreateIndex
CREATE INDEX "accounting_entries_circularId_idx" ON "accounting_entries"("circularId");

-- CreateIndex
CREATE INDEX "accounting_entries_ruleId_idx" ON "accounting_entries"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_portalClientId_competencia_eventType_origem_key" ON "accounting_entries"("portalClientId", "competencia", "eventType", "origem");

-- Partial unique indexes for active rules
CREATE UNIQUE INDEX "accounting_entry_rules_company_active_event_key" ON "accounting_entry_rules"("portalClientId", "eventType") WHERE "portalClientId" IS NOT NULL AND "isActive" = true;
CREATE UNIQUE INDEX "accounting_entry_rules_global_active_event_key" ON "accounting_entry_rules"("eventType") WHERE "portalClientId" IS NULL AND "isActive" = true;

-- AddForeignKey
ALTER TABLE "company_monthly_circulars" ADD CONSTRAINT "company_monthly_circulars_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entry_rules" ADD CONSTRAINT "accounting_entry_rules_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_circularId_fkey" FOREIGN KEY ("circularId") REFERENCES "company_monthly_circulars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "accounting_entry_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
