-- Permitir conta global no plano de contas (portalClientId = NULL).

-- 1. Drop FK constraint atual para recriar com SET NULL on cascade quando necessário
ALTER TABLE "chart_of_accounts" DROP CONSTRAINT "chart_of_accounts_portalClientId_fkey";

-- 2. Tornar coluna nullable
ALTER TABLE "chart_of_accounts" ALTER COLUMN "portalClientId" DROP NOT NULL;

-- 3. Recriar FK aceitando NULL (quando empresa for deletada, conta global permanece com portalClientId = NULL via SET NULL)
-- NOTA: a tabela referenciada no banco é "PortalClient" (capitalizada, sem @@map convertendo para portal_clients no DB de produção)
ALTER TABLE "chart_of_accounts"
  ADD CONSTRAINT "chart_of_accounts_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Índice único parcial: garante que não haja dois códigos globais iguais.
-- A unique constraint @@unique([portalClientId, codigo]) do Prisma trata NULL como distinto
-- (Postgres permite múltiplos NULLs em UNIQUE), então adicionamos esta partial unique para globais.
CREATE UNIQUE INDEX "chart_of_accounts_global_codigo_unique"
  ON "chart_of_accounts" ("codigo")
  WHERE "portalClientId" IS NULL;
