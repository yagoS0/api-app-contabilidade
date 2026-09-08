CREATE TABLE "saldos_iniciais_fluxo" (
  "id" SERIAL NOT NULL,
  "portalClientId" TEXT NOT NULL,
  "dataReferencia" DATE,
  "valor" DECIMAL(18,2),
  "criadoPor" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saldos_iniciais_fluxo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saldos_iniciais_fluxo_anchor_check" CHECK (
    ("valor" IS NULL AND "dataReferencia" IS NULL) OR
    ("valor" IS NOT NULL AND "dataReferencia" IS NOT NULL AND EXTRACT(DAY FROM "dataReferencia") = 1)
  ),
  CONSTRAINT "saldos_iniciais_fluxo_portalClientId_fkey" FOREIGN KEY ("portalClientId")
    REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "saldos_iniciais_fluxo_portalClientId_id_idx" ON "saldos_iniciais_fluxo"("portalClientId", "id");
