-- Q17: fechamento CONTÁBIL do mês (distinto do `estado` da apuração/notas).
ALTER TABLE "company_monthly_circulars" ADD COLUMN "fechadoContabilEm" TIMESTAMP(3);
ALTER TABLE "company_monthly_circulars" ADD COLUMN "fechadoContabilPor" TEXT;
