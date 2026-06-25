-- Q28 Fase 3: estado explícito da parcela (guias de parcelamento). ADD-only: sem DROP, sem reset.
ALTER TABLE "Guide" ADD COLUMN "parcelaEstado" TEXT;

-- CreateIndex
CREATE INDEX "Guide_portalClientId_parcelaEstado_idx" ON "Guide"("portalClientId", "parcelaEstado");
