-- Q40: SERPRO Integra Contador — confirmação de pagamento (PAGTOWEB) + SITFIS.
-- ADD-only (sem DROP / sem reset). Backup antes de aplicar.

-- Guide: comprovante oficial de arrecadação (PAGTOWEB/COMPARRECADACAO) quando o pagamento é confirmado.
ALTER TABLE "Guide" ADD COLUMN IF NOT EXISTS "comprovantePdfFileId" TEXT;

-- CompanyFiscalStatus: última consulta de situação fiscal (SITFIS) por empresa.
CREATE TABLE IF NOT EXISTS "company_fiscal_status" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "tipo" INTEGER NOT NULL DEFAULT 2,
  "situacao" TEXT,
  "protocolo" TEXT,
  "relatorioPdfFileId" TEXT,
  "texto" TEXT,
  "rawPayload" JSONB,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_fiscal_status_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_fiscal_status_portalClientId_key"
  ON "company_fiscal_status"("portalClientId");

-- FK com cascade (empresa excluída → status removido junto).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_fiscal_status_portalClientId_fkey'
  ) THEN
    ALTER TABLE "company_fiscal_status"
      ADD CONSTRAINT "company_fiscal_status_portalClientId_fkey"
      FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
