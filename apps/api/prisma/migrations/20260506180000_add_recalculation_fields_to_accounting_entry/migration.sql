-- AlterTable
ALTER TABLE "accounting_entries"
  ADD COLUMN "recalculatedAt" TIMESTAMP(3),
  ADD COLUMN "recalculatedFromValor" DECIMAL(18, 2),
  ADD COLUMN "recalculatedToValor" DECIMAL(18, 2),
  ADD COLUMN "recalculatedNotes" TEXT;
