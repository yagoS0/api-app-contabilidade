-- AlterTable
ALTER TABLE "company_monthly_circulars"
ADD COLUMN "pgdasNumeroDeclaracao" TEXT,
ADD COLUMN "pgdasDeclaracaoFileId" TEXT,
ADD COLUMN "pgdasDeclaracaoFileUrl" TEXT,
ADD COLUMN "pgdasReciboFileId" TEXT,
ADD COLUMN "pgdasReciboFileUrl" TEXT,
ADD COLUMN "receitaStatus" TEXT,
ADD COLUMN "dasStatus" TEXT,
ADD COLUMN "serproSyncStatus" TEXT,
ADD COLUMN "serproLastSyncAt" TIMESTAMPTZ,
ADD COLUMN "serproLastError" TEXT;
