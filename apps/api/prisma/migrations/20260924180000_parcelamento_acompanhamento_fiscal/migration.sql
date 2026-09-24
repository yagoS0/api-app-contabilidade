-- AlterTable
ALTER TABLE "parcelamentos" ADD COLUMN     "fiscalConfirmadoEm" TIMESTAMP(3),
ADD COLUMN     "fiscalRawPayload" JSONB,
ADD COLUMN     "fiscalSituacao" TEXT,
ADD COLUMN     "ultimaConsultaParcelasEm" TIMESTAMP(3),
ADD COLUMN     "ultimaConsultaParcelasResultado" TEXT,
ALTER COLUMN "numParcelas" DROP NOT NULL,
ALTER COLUMN "principalPerParcela" DROP NOT NULL,
ALTER COLUMN "totalValue" DROP NOT NULL,
ALTER COLUMN "competenciaInicial" DROP NOT NULL;

-- AlterTable
ALTER TABLE "parcelas" ADD COLUMN     "pagamentoConsultadoEm" TIMESTAMP(3),
ADD COLUMN     "pagamentoEm" TIMESTAMP(3),
ADD COLUMN     "pagamentoErro" TEXT,
ADD COLUMN     "pagamentoEvidencia" JSONB,
ADD COLUMN     "pagamentoStatus" TEXT,
ADD COLUMN     "valorPago" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "parcelamento_indicacoes" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "chaveOrigem" TEXT NOT NULL,
    "modalidade" TEXT,
    "numeroParcelamento" TEXT,
    "parcelasEmAtraso" INTEGER,
    "origem" TEXT NOT NULL DEFAULT 'SITFIS',
    "evidenciaEm" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "parcelamentoId" TEXT,
    "resolvidoEm" TIMESTAMP(3),
    "resolvidoPor" TEXT,
    "motivo" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcelamento_indicacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcelamento_indicacao_eventos" (
    "id" TEXT NOT NULL,
    "indicacaoId" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "usuarioId" TEXT,
    "dados" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcelamento_indicacao_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcelamento_capturas" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "parcelamentoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "anoMesParcela" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDENTE',
    "owner" TEXT,
    "reservadoAte" TIMESTAMP(3),
    "pdfBytes" BYTEA,
    "numeroDocumento" TEXT,
    "rawPayload" JSONB,
    "guideId" TEXT,
    "erro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcelamento_capturas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parcelamento_indicacoes_portalClientId_status_idx" ON "parcelamento_indicacoes"("portalClientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "parcelamento_indicacoes_portalClientId_chaveOrigem_key" ON "parcelamento_indicacoes"("portalClientId", "chaveOrigem");

-- CreateIndex
CREATE INDEX "parcelamento_indicacao_eventos_indicacaoId_createdAt_idx" ON "parcelamento_indicacao_eventos"("indicacaoId", "createdAt");

-- CreateIndex
CREATE INDEX "parcelamento_capturas_portalClientId_estado_idx" ON "parcelamento_capturas"("portalClientId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "parcelamento_capturas_parcelamentoId_anoMesParcela_key" ON "parcelamento_capturas"("parcelamentoId", "anoMesParcela");
