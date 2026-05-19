-- AlterTable
ALTER TABLE "accounting_entry_rules" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "accounting_historicos" ADD COLUMN     "historicoSugerido" TEXT;

-- AlterTable
ALTER TABLE "company_monthly_circulars" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "inssVencimento" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "serproLastSyncAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "dasDataEmissao" SET DATA TYPE TIMESTAMP(3);

-- RenameIndex
ALTER INDEX "accounting_entries_portalClientId_competencia_eventType_origem_" RENAME TO "accounting_entries_portalClientId_competencia_eventType_ori_key";
