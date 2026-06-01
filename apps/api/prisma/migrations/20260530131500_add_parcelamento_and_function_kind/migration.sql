-- Q9: cabeçalho Parcelamento + FKs em AccountingEntry e Guide + campo kind em AccountingFunction.
-- Backup feito: enviar-20260530-130944.dump

-- AlterTable
ALTER TABLE "Guide" ADD COLUMN     "numeroParcela" INTEGER,
ADD COLUMN     "parcelamentoId" TEXT;

-- AlterTable
ALTER TABLE "accounting_entries" ADD COLUMN     "numeroParcela" INTEGER,
ADD COLUMN     "parcelamentoId" TEXT;

-- AlterTable
ALTER TABLE "accounting_functions" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "parcelamentos" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateOpeningFunctionId" TEXT,
    "templatePaymentFunctionId" TEXT,
    "templateRescisionFunctionId" TEXT,
    "numEntradas" INTEGER NOT NULL DEFAULT 0,
    "numParcelas" INTEGER NOT NULL,
    "principalPerParcela" DECIMAL(18,2) NOT NULL,
    "principalTotal" DECIMAL(18,2),
    "jurosTotal" DECIMAL(18,2),
    "totalValue" DECIMAL(18,2) NOT NULL,
    "dataAbertura" TIMESTAMP(3),
    "competenciaInicial" TEXT NOT NULL,
    "diaPagamento" INTEGER NOT NULL DEFAULT 1,
    "periodosReferenciados" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "observacoes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "aberturaEntryId" TEXT,

    CONSTRAINT "parcelamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parcelamentos_aberturaEntryId_key" ON "parcelamentos"("aberturaEntryId");

-- CreateIndex
CREATE INDEX "parcelamentos_portalClientId_status_idx" ON "parcelamentos"("portalClientId", "status");

-- CreateIndex
CREATE INDEX "parcelamentos_portalClientId_kind_idx" ON "parcelamentos"("portalClientId", "kind");

-- CreateIndex
CREATE INDEX "Guide_parcelamentoId_idx" ON "Guide"("parcelamentoId");

-- CreateIndex
CREATE INDEX "accounting_entries_parcelamentoId_idx" ON "accounting_entries"("parcelamentoId");

-- CreateIndex
CREATE INDEX "accounting_functions_kind_idx" ON "accounting_functions"("kind");

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_parcelamentoId_fkey" FOREIGN KEY ("parcelamentoId") REFERENCES "parcelamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_parcelamentoId_fkey" FOREIGN KEY ("parcelamentoId") REFERENCES "parcelamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_aberturaEntryId_fkey" FOREIGN KEY ("aberturaEntryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_templateOpeningFunctionId_fkey" FOREIGN KEY ("templateOpeningFunctionId") REFERENCES "accounting_functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_templatePaymentFunctionId_fkey" FOREIGN KEY ("templatePaymentFunctionId") REFERENCES "accounting_functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_templateRescisionFunctionId_fkey" FOREIGN KEY ("templateRescisionFunctionId") REFERENCES "accounting_functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
