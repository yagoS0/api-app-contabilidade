-- ⚠⚠ ADITIVA E NULA. Coluna nova, sem default e sem backfill.
--
-- `null` = "ninguem escolheu o credito", e aí vale o caixa cravado (111010001) — o comportamento
-- medido das 155 despesas que já existem. Preencher todas com o caixa afirmaria uma escolha que
-- ninguém fez, e apagaria a diferença entre "é caixa porque escolheram" e "é caixa por padrão".
ALTER TABLE "lancamentos_declarados" ADD COLUMN "contaCredito" TEXT;
