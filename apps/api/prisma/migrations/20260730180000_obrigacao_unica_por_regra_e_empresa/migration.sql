-- Uma regra do escritório produz NO MÁXIMO uma obrigação por empresa.
-- Sem isso, uma propagação executada duas vezes criaria linhas iguais e o contador veria a mesma
-- entrega em dobro no calendário. Obrigação avulsa (regraId nulo) não é afetada: o Postgres não
-- compara NULLs entre si num índice único.
CREATE UNIQUE INDEX "obrigacoes_regraId_portalClientId_key" ON "obrigacoes"("regraId", "portalClientId");
