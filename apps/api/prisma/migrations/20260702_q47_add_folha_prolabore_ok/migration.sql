-- Q47: pré-requisito de folha/pró-labore para o fechamento contábil do mês.
-- Aditiva e não-destrutiva: só adiciona a coluna nullable (default null = pendente).
ALTER TABLE "company_monthly_circulars" ADD COLUMN "folhaProlaboreOk" BOOLEAN;
