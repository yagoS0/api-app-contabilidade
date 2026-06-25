-- Q21 (spec v2): parcelamento — composição por tributo + memória de conta por tributo + campos.
-- ADD-only (sem reset). NULLs são distintos em UNIQUE no Postgres → manual sem número não colide.

-- Parcelamento (+ modalidade/número oficial + consolidados/calendário)
ALTER TABLE "parcelamentos" ADD COLUMN "tipo" TEXT;
ALTER TABLE "parcelamentos" ADD COLUMN "numeroParcelamento" TEXT;
ALTER TABLE "parcelamentos" ADD COLUMN "valorMulta" DECIMAL(18,2);
ALTER TABLE "parcelamentos" ADD COLUMN "valorParcelaReferencia" DECIMAL(18,2);
ALTER TABLE "parcelamentos" ADD COLUMN "parcelaInicial" INTEGER;
ALTER TABLE "parcelamentos" ADD COLUMN "dataAdesao" TIMESTAMP(3);
ALTER TABLE "parcelamentos" ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'MANUAL';
CREATE UNIQUE INDEX "parcelamentos_portalClientId_tipo_numeroParcelamento_key"
  ON "parcelamentos"("portalClientId", "tipo", "numeroParcelamento");

-- Guide (+ metadados de parcela + estado de baixa)
ALTER TABLE "Guide" ADD COLUMN "quantidadeParcelas" INTEGER;
ALTER TABLE "Guide" ADD COLUMN "anoMesParcela" TEXT;
ALTER TABLE "Guide" ADD COLUMN "lancamentoId" TEXT;
ALTER TABLE "Guide" ADD COLUMN "baixada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Guide" ADD COLUMN "dataBaixa" TIMESTAMP(3);
CREATE INDEX "Guide_baixada_idx" ON "Guide"("baixada");
CREATE UNIQUE INDEX "Guide_parcelamentoId_numeroParcela_key" ON "Guide"("parcelamentoId", "numeroParcela");

-- AccountingEntryLine (+ papel da linha + tributo)
ALTER TABLE "accounting_entry_lines" ADD COLUMN "tipoLinha" TEXT;
ALTER TABLE "accounting_entry_lines" ADD COLUMN "codigoTributo" TEXT;

-- TributoParcela (composição por tributo — juros LIDO, nunca derivado)
CREATE TABLE "tributos_parcela" (
  "id" TEXT NOT NULL,
  "guideId" TEXT NOT NULL,
  "codigoTributo" TEXT NOT NULL,
  "nomeTributo" TEXT,
  "principal" DECIMAL(18,2) NOT NULL,
  "multa" DECIMAL(18,2) NOT NULL,
  "juros" DECIMAL(18,2) NOT NULL,
  "total" DECIMAL(18,2) NOT NULL,
  "verificadoTrial" BOOLEAN NOT NULL DEFAULT false,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tributos_parcela_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tributos_parcela_guideId_codigoTributo_key" ON "tributos_parcela"("guideId", "codigoTributo");
CREATE INDEX "tributos_parcela_guideId_idx" ON "tributos_parcela"("guideId");
ALTER TABLE "tributos_parcela" ADD CONSTRAINT "tributos_parcela_guideId_fkey"
  FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MapaContaTributo (memória de conta por tributo — GLOBAL + override por cliente)
CREATE TABLE "mapa_conta_tributo" (
  "id" TEXT NOT NULL,
  "portalClientId" TEXT,
  "tipoParcelamento" TEXT NOT NULL,
  "tipoLinha" TEXT NOT NULL,
  "codigoTributo" TEXT,
  "contaId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mapa_conta_tributo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mapa_conta_tributo_portalClientId_tipoParcelamento_tipoLinha_codigoTributo_key"
  ON "mapa_conta_tributo"("portalClientId", "tipoParcelamento", "tipoLinha", "codigoTributo");
CREATE INDEX "mapa_conta_tributo_portalClientId_tipoParcelamento_idx"
  ON "mapa_conta_tributo"("portalClientId", "tipoParcelamento");
