-- Portal Cliente (#3.1): liberação de guias ao cliente.
-- Aditiva e não-destrutiva: só adiciona colunas (default false / nullable) + índice.
ALTER TABLE "Guide" ADD COLUMN "liberadaCliente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Guide" ADD COLUMN "liberadaEm" TIMESTAMP(3);
ALTER TABLE "Guide" ADD COLUMN "liberadaPor" TEXT;

CREATE INDEX "Guide_portalClientId_liberadaCliente_competencia_idx" ON "Guide" ("portalClientId", "liberadaCliente", "competencia");
