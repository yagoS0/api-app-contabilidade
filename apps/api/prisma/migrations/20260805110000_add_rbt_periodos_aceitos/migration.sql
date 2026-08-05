-- Os períodos que a RFB aceita, guardados entre simulações do PGDAS-D.
--
-- O laço de convergência descobria a lista por tentativa e erro: a RFB rejeita apontando um mês
-- "desnecessário", o código remove aquele mês e re-executa — e cada re-execução é uma chamada
-- COBRADA. Medido em produção: 18 rejeições para 1 sucesso na mesma empresa, e exatamente o mesmo
-- custo repetido no dia seguinte, porque nada era guardado. 75 das 214 chamadas pagas do mês (35%)
-- eram esse laço.
--
-- Fica em coluna PRÓPRIA, sem tocar em `origem`: a RFB não devolve RBT12 (o número é nosso), mas
-- QUAIS PERÍODOS ela aceita é informação dela.

ALTER TABLE "rbt_extrato_cache" ADD COLUMN "periodosAceitos" JSONB;
ALTER TABLE "rbt_extrato_cache" ADD COLUMN "periodosAceitosEm" TIMESTAMP(3);
