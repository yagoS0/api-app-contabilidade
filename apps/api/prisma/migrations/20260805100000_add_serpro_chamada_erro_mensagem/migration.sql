-- A mensagem do erro no log de chamadas pagas ao SERPRO.
--
-- O código é genérico: 75 chamadas de um mês (35% do orçamento) entraram como
-- `SERPRO_BUSINESS_ERROR`, sem nada que dissesse o motivo. Eram rejeições de "período
-- desnecessário" do laço de convergência do PGDAS-D — e descobrir isso exigiu cruzar contagem por
-- serviço com agrupamento por minuto. Com a mensagem, a mesma pergunta se responde num `groupBy`.

ALTER TABLE "serpro_chamadas" ADD COLUMN "erroMensagem" TEXT;
