CREATE TABLE "ReformaFiscalRevisao" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "versao" INTEGER NOT NULL,
  "dados" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReformaFiscalRevisao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReformaFiscalRevisao_versao_check" CHECK ("versao" > 0),
  CONSTRAINT "ReformaFiscalRevisao_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReformaFiscalRevisao_portalClientId_versao_key" ON "ReformaFiscalRevisao"("portalClientId", "versao");

CREATE TABLE "ReformaNfseVerificacao" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "competencia" TEXT NOT NULL,
  "cadastroVersao" INTEGER NOT NULL,
  "versaoRegras" TEXT NOT NULL,
  "origem" JSONB NOT NULL,
  "resumo" JSONB NOT NULL,
  "itens" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReformaNfseVerificacao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReformaNfseVerificacao_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReformaNfseVerificacao_portalClientId_competencia_createdAt_idx" ON "ReformaNfseVerificacao"("portalClientId", "competencia", "createdAt");
