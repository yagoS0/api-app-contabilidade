-- Robustez NFS-e/ADN — Fase 1: ledger append-only de documentos fiscais.
-- Tudo aditivo (CREATE TABLE + CREATE INDEX). Sem FK de propósito: o ledger é dado de
-- auditoria (append-only) e não deve ser apagado em cascata se o PortalClient for removido.

-- CreateTable
CREATE TABLE "documentos" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "chaveAcesso" TEXT NOT NULL,
    "cnpjPrestador" TEXT,
    "cnpjTomador" TEXT,
    "municipioIbge" TEXT,
    "numeroNfse" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "dataRecepcaoAdn" TIMESTAMP(3),
    "competencia" TEXT,
    "valorServico" DECIMAL(18,2),
    "xmlOriginal" TEXT,
    "nsuOrigem" BIGINT,
    "fonte" TEXT NOT NULL,
    "capturadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "chaveAcesso" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "nSeqEvento" INTEGER NOT NULL DEFAULT 1,
    "dataEvento" TIMESTAMP(3),
    "justificativa" TEXT,
    "chaveSubstituta" TEXT,
    "xmlEvento" TEXT,
    "nsuOrigem" BIGINT,
    "fonte" TEXT NOT NULL,
    "capturadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nsu_watermark" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "ultimoNsuProcessado" BIGINT NOT NULL DEFAULT 0,
    "primeiroNsuDisponivel" BIGINT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nsu_watermark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nsu_gaps" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "nsuFaltante" BIGINT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "detectadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nsu_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documentos_portalClientId_chaveAcesso_key" ON "documentos"("portalClientId", "chaveAcesso");

-- CreateIndex
CREATE INDEX "documentos_portalClientId_competencia_idx" ON "documentos"("portalClientId", "competencia");

-- CreateIndex
CREATE INDEX "documentos_chaveAcesso_idx" ON "documentos"("chaveAcesso");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_chaveAcesso_tipoEvento_nSeqEvento_key" ON "eventos"("chaveAcesso", "tipoEvento", "nSeqEvento");

-- CreateIndex
CREATE INDEX "eventos_portalClientId_chaveAcesso_idx" ON "eventos"("portalClientId", "chaveAcesso");

-- CreateIndex
CREATE UNIQUE INDEX "nsu_watermark_portalClientId_fonte_key" ON "nsu_watermark"("portalClientId", "fonte");

-- CreateIndex
CREATE UNIQUE INDEX "nsu_gaps_portalClientId_fonte_nsuFaltante_key" ON "nsu_gaps"("portalClientId", "fonte", "nsuFaltante");

-- CreateIndex
CREATE INDEX "nsu_gaps_portalClientId_status_idx" ON "nsu_gaps"("portalClientId", "status");
