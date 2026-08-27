-- CONFIRMAÇÃO DE PAGAMENTO PELO CLIENTE — duas colunas próprias, aditivas e nulas.
--
-- ⚠⚠ POR QUE NÃO REUSAR `paymentConfirmedAt` / `paymentConfirmedByUserId`.
-- A confirmação do cliente NÃO se perde quando o SERPRO depois localiza o comprovante: a
-- procedência é PROMOVIDA a 'SERPRO' (prova vence afirmação), e `markGuidePaidBySerpro` **zera**
-- aquelas duas colunas — corretamente, porque lá elas descrevem uma confirmação MANUAL que deixou
-- de valer. Guardar a afirmação do cliente nelas apagaria quem disse o quê.
--
-- ⚠ ADITIVA E SEM BACKFILL, de propósito: nenhum dado existente no banco prova que algum cliente
-- confirmou pagamento — a capacidade nasce agora. Inventar uma data para linhas antigas seria
-- fabricar registro de afirmação fiscal.
--
-- ⚠ SEM FK para "User": `paymentConfirmedByUserId` também é `String?` solto no mesmo model, e uma
-- FK só nesta coluna criaria duas regras diferentes para a mesma pergunta na mesma tabela.
ALTER TABLE "Guide" ADD COLUMN IF NOT EXISTS "clienteConfirmouEm" TIMESTAMP(3);
ALTER TABLE "Guide" ADD COLUMN IF NOT EXISTS "clienteConfirmouPorUserId" TEXT;
