-- WhatsApp — Entrega 2 (02/09/2026): o REGISTRO de cada chamada ao modelo (Anthropic), no molde de
-- `serpro_chamadas`. É dele que saem o teto mensal (por empresa e do escritório) e a tela de consumo.
-- Custo em CENTAVOS DE DÓLAR, ESTIMADO pela tabela versionada em `precosIa.js`.

CREATE TABLE "chamadas_ia" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT,
    "portalClientId" TEXT,
    "mensagemId" TEXT,
    "modelo" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "custoEstimadoCentavos" INTEGER NOT NULL DEFAULT 0,
    "duracaoMs" INTEGER,
    "iteracoes" INTEGER NOT NULL DEFAULT 0,
    "ferramentas" JSONB,
    "stopReason" TEXT,
    "status" TEXT NOT NULL,
    "erroCodigo" TEXT,
    "erroMensagem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chamadas_ia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chamadas_ia_portalClientId_createdAt_idx" ON "chamadas_ia"("portalClientId", "createdAt" DESC);
CREATE INDEX "chamadas_ia_createdAt_idx" ON "chamadas_ia"("createdAt" DESC);

ALTER TABLE "chamadas_ia"
  ADD CONSTRAINT "chamadas_ia_conversaId_fkey"
  FOREIGN KEY ("conversaId") REFERENCES "conversas_whatsapp"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chamadas_ia"
  ADD CONSTRAINT "chamadas_ia_portalClientId_fkey"
  FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
