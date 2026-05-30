-- AlterTable
ALTER TABLE "accounting_entries" ADD COLUMN     "sourceGuideId" TEXT;

-- CreateTable
CREATE TABLE "accounting_functions" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_function_entries" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "historico" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "subtipo" TEXT,

    CONSTRAINT "accounting_function_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_function_lines" (
    "id" TEXT NOT NULL,
    "functionEntryId" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "accounting_function_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_functions_portalClientId_idx" ON "accounting_functions"("portalClientId");

-- CreateIndex
CREATE INDEX "accounting_functions_isSystem_idx" ON "accounting_functions"("isSystem");

-- CreateIndex
CREATE INDEX "accounting_function_entries_functionId_idx" ON "accounting_function_entries"("functionId");

-- CreateIndex
CREATE INDEX "accounting_function_lines_functionEntryId_idx" ON "accounting_function_lines"("functionEntryId");

-- CreateIndex
CREATE INDEX "accounting_entries_sourceGuideId_idx" ON "accounting_entries"("sourceGuideId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_sourceGuideId_eventType_key" ON "accounting_entries"("sourceGuideId", "eventType");

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_sourceGuideId_fkey" FOREIGN KEY ("sourceGuideId") REFERENCES "Guide"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_functions" ADD CONSTRAINT "accounting_functions_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_function_entries" ADD CONSTRAINT "accounting_function_entries_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "accounting_functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_function_lines" ADD CONSTRAINT "accounting_function_lines_functionEntryId_fkey" FOREIGN KEY ("functionEntryId") REFERENCES "accounting_function_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
