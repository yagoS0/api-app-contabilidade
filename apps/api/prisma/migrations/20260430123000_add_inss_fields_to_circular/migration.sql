-- AlterTable
ALTER TABLE "company_monthly_circulars"
ADD COLUMN "inssVencimento" TIMESTAMPTZ,
ADD COLUMN "inssPdfFileId" TEXT,
ADD COLUMN "inssPdfUrl" TEXT,
ADD COLUMN "inssStatus" TEXT;
