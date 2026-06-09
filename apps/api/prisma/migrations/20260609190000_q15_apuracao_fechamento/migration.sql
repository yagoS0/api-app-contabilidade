-- AlterTable
ALTER TABLE "apuracao_snapshots" ADD COLUMN     "atividadesEscolhidas" JSONB,
ADD COLUMN     "disparidades" JSONB,
ADD COLUMN     "fechadaEm" TIMESTAMP(3),
ADD COLUMN     "fechadaPor" TEXT,
ADD COLUMN     "folhaMensal12" JSONB,
ADD COLUMN     "receitaExterna" DECIMAL(18,2),
ADD COLUMN     "receitaInterna" DECIMAL(18,2),
ADD COLUMN     "simulacaoSerpro" JSONB,
ADD COLUMN     "tributosPorTributo" JSONB;

-- AlterTable
ALTER TABLE "cadastros_fiscais" ADD COLUMN     "regimeApuracao" TEXT NOT NULL DEFAULT 'COMPETENCIA';

-- CreateTable
CREATE TABLE "apuracao_batch_items" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "dasValor" DECIMAL(18,2),
    "numeroDeclaracao" TEXT,
    "erroMensagem" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "backoffUntil" TIMESTAMP(3),
    "processadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apuracao_batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rbt_extrato_cache" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "rbt12" DECIMAL(18,2) NOT NULL,
    "detalhePorMes" JSONB NOT NULL,
    "origem" TEXT NOT NULL,
    "capturadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rbt_extrato_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apuracao_config_memory" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "atividadesEscolhidas" JSONB NOT NULL,
    "folhaMensal12" JSONB,
    "regimeApuracao" TEXT,
    "flags" JSONB,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoPor" TEXT,

    CONSTRAINT "apuracao_config_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atividades_pgdasd" (
    "id" TEXT NOT NULL,
    "idAtividade" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "anexoImplicito" TEXT NOT NULL,
    "mercado" TEXT NOT NULL DEFAULT 'INTERNO',
    "sujeitoFatorR" BOOLEAN NOT NULL DEFAULT false,
    "tipoReceita" TEXT,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "verificadoTrial" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "atividades_pgdasd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apuracao_batch_items_jobId_idx" ON "apuracao_batch_items"("jobId");

-- CreateIndex
CREATE INDEX "apuracao_batch_items_status_backoffUntil_idx" ON "apuracao_batch_items"("status", "backoffUntil");

-- CreateIndex
CREATE INDEX "rbt_extrato_cache_portalClientId_idx" ON "rbt_extrato_cache"("portalClientId");

-- CreateIndex
CREATE UNIQUE INDEX "rbt_extrato_cache_portalClientId_competencia_key" ON "rbt_extrato_cache"("portalClientId", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "apuracao_config_memory_portalClientId_key" ON "apuracao_config_memory"("portalClientId");

-- CreateIndex
CREATE INDEX "atividades_pgdasd_tipoReceita_mercado_idx" ON "atividades_pgdasd"("tipoReceita", "mercado");

-- CreateIndex
CREATE UNIQUE INDEX "atividades_pgdasd_idAtividade_vigenciaInicio_key" ON "atividades_pgdasd"("idAtividade", "vigenciaInicio");

