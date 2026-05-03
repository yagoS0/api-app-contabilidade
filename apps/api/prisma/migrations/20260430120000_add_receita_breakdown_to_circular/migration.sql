-- AlterTable
ALTER TABLE "company_monthly_circulars"
ADD COLUMN "receitaServicos" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "receitaVendas" DECIMAL(18,2) NOT NULL DEFAULT 0;
