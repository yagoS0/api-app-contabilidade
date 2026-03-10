ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "regimeTributario" TEXT,
  ADD COLUMN IF NOT EXISTS "simplesAnexo" TEXT,
  ADD COLUMN IF NOT EXISTS "simplesDataOpcao" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cnaePrincipal" TEXT,
  ADD COLUMN IF NOT EXISTS "cnaesSecundarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "enderecoJson" JSONB;

CREATE INDEX IF NOT EXISTS "Company_regimeTributario_idx" ON "Company" ("regimeTributario");
CREATE INDEX IF NOT EXISTS "Company_cnaePrincipal_idx" ON "Company" ("cnaePrincipal");

