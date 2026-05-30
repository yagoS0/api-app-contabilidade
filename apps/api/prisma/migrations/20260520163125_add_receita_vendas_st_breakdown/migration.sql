-- AlterTable
ALTER TABLE "company_monthly_circulars" ADD COLUMN     "receitaVendasComST" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "receitaVendasSemST" DECIMAL(18,2) NOT NULL DEFAULT 0;
