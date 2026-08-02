-- "O mês não teve faturamento" — afirmação POR COMPETÊNCIA, feita pelo contador.
--
-- Tri-estado como o checklist ao lado: NULL = ninguém disse nada, que é diferente de "disseram
-- que teve". Quem e quando ficam gravados porque isto é afirmação fiscal, não preferência de tela:
-- tira a exigência do DAS do mês, e um dia alguém vai perguntar quem afirmou isso.
--
-- A recusa (não marcar quando há nota EMIT autorizada na competência) vive na rota, usando a MESMA
-- função de faturamento que a apuração usa.
ALTER TABLE "company_monthly_circulars" ADD COLUMN     "semFaturamento" BOOLEAN,
ADD COLUMN     "semFaturamentoEm" TIMESTAMP(3),
ADD COLUMN     "semFaturamentoPor" TEXT;
