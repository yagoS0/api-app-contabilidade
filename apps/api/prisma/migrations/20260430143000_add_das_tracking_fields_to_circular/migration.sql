-- AlterTable
ALTER TABLE "company_monthly_circulars"
ADD COLUMN "dasNumeroDocumento" TEXT,
ADD COLUMN "dasPago" BOOLEAN,
ADD COLUMN "dasDataEmissao" TIMESTAMPTZ;
