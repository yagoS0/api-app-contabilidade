-- CreateEnum
CREATE TYPE "TipoReceita" AS ENUM ('REVENDA_MERCADORIA', 'INDUSTRIALIZACAO', 'SERVICO_ANEXO_III', 'SERVICO_ANEXO_IV', 'SERVICO_ANEXO_V', 'SERVICO_FATOR_R', 'RECEITA_NAO_CLASSIFICADA');

-- CreateTable
CREATE TABLE "cadastros_fiscais" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "dataOpcaoSN" TIMESTAMP(3),
    "cnaePrincipal" TEXT NOT NULL,
    "cnaesSecundarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sublimiteICMSISS" BOOLEAN NOT NULL DEFAULT false,
    "usaFatorR" BOOLEAN NOT NULL DEFAULT false,
    "observacoes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cadastros_fiscais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos_servicos" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipoReceita" "TipoReceita" NOT NULL,
    "codigoServico" TEXT,
    "ncm" TEXT,
    "cfop" TEXT,
    "codigoInterno" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "origem" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produtos_servicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regras_classificacao" (
    "id" TEXT NOT NULL,
    "escopo" TEXT NOT NULL,
    "portalClientId" TEXT,
    "tipoCodigo" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipoReceita" "TipoReceita" NOT NULL,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "vigenciaInicio" TIMESTAMP(3),
    "vigenciaFim" TIMESTAMP(3),
    "fonte" TEXT NOT NULL,
    "descricao" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regras_classificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cnae_anexo" (
    "cnae" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipoReceitaSugerido" "TipoReceita" NOT NULL,
    "ambiguo" BOOLEAN NOT NULL DEFAULT false,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),

    CONSTRAINT "cnae_anexo_pkey" PRIMARY KEY ("cnae")
);

-- CreateTable
CREATE TABLE "aliquotas_sn" (
    "id" TEXT NOT NULL,
    "anexo" TEXT NOT NULL,
    "faixa" INTEGER NOT NULL,
    "rbt12Min" DECIMAL(18,2) NOT NULL,
    "rbt12Max" DECIMAL(18,2) NOT NULL,
    "aliquotaNominal" DECIMAL(6,4) NOT NULL,
    "parcelaDeduzir" DECIMAL(18,2) NOT NULL,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),

    CONSTRAINT "aliquotas_sn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fila_pendencias" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "notaId" TEXT,
    "itemId" TEXT,
    "competencia" TEXT,
    "resumo" TEXT NOT NULL,
    "detalhes" JSONB NOT NULL,
    "resolvida" BOOLEAN NOT NULL DEFAULT false,
    "resolvidaPor" TEXT,
    "resolvidaEm" TIMESTAMP(3),
    "acaoResolucao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fila_pendencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apuracao_snapshots" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "rbt12" DECIMAL(18,2) NOT NULL,
    "folha12m" DECIMAL(18,2),
    "fatorR" DECIMAL(6,4),
    "receitaPorTipo" JSONB NOT NULL,
    "receitaPorAnexo" JSONB NOT NULL,
    "dasCalculadoLocal" DECIMAL(18,2),
    "aliquotaEfetivaPorAnexo" JSONB,
    "vigenciaAliquota" TIMESTAMP(3),
    "dasRetornadoSerpro" DECIMAL(18,2),
    "divergenciaValor" DECIMAL(18,2),
    "rbt12Extrato" DECIMAL(18,2),
    "divergenciaRbt12" DECIMAL(18,2),
    "numeroDeclaracao" TEXT,
    "reciboNumero" TEXT,
    "transmitidoEm" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'pendente',
    "idempotencyKey" TEXT NOT NULL,
    "erroMensagem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apuracao_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_decisoes_fator_r" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "folha12m" DECIMAL(18,2) NOT NULL,
    "rbt12" DECIMAL(18,2) NOT NULL,
    "fatorR" DECIMAL(6,4) NOT NULL,
    "threshold" DECIMAL(6,4) NOT NULL DEFAULT 0.28,
    "anexoDecidido" TEXT NOT NULL,
    "fonteFolha" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_decisoes_fator_r_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apuracao_batch_jobs" (
    "id" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "totalEmpresas" INTEGER NOT NULL,
    "processadas" INTEGER NOT NULL DEFAULT 0,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "pendenteCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "triggeredBy" TEXT,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    "resumo" JSONB,

    CONSTRAINT "apuracao_batch_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cadastros_fiscais_portalClientId_key" ON "cadastros_fiscais"("portalClientId");

-- CreateIndex
CREATE INDEX "produtos_servicos_portalClientId_codigoServico_idx" ON "produtos_servicos"("portalClientId", "codigoServico");

-- CreateIndex
CREATE INDEX "produtos_servicos_portalClientId_ncm_idx" ON "produtos_servicos"("portalClientId", "ncm");

-- CreateIndex
CREATE INDEX "produtos_servicos_portalClientId_ativo_idx" ON "produtos_servicos"("portalClientId", "ativo");

-- CreateIndex
CREATE INDEX "regras_classificacao_escopo_tipoCodigo_codigo_vigenciaInici_idx" ON "regras_classificacao"("escopo", "tipoCodigo", "codigo", "vigenciaInicio");

-- CreateIndex
CREATE INDEX "regras_classificacao_portalClientId_escopo_idx" ON "regras_classificacao"("portalClientId", "escopo");

-- CreateIndex
CREATE INDEX "cnae_anexo_tipoReceitaSugerido_idx" ON "cnae_anexo"("tipoReceitaSugerido");

-- CreateIndex
CREATE INDEX "aliquotas_sn_anexo_vigenciaInicio_idx" ON "aliquotas_sn"("anexo", "vigenciaInicio");

-- CreateIndex
CREATE UNIQUE INDEX "aliquotas_sn_anexo_faixa_vigenciaInicio_key" ON "aliquotas_sn"("anexo", "faixa", "vigenciaInicio");

-- CreateIndex
CREATE INDEX "fila_pendencias_portalClientId_resolvida_tipo_idx" ON "fila_pendencias"("portalClientId", "resolvida", "tipo");

-- CreateIndex
CREATE INDEX "fila_pendencias_portalClientId_competencia_resolvida_idx" ON "fila_pendencias"("portalClientId", "competencia", "resolvida");

-- CreateIndex
CREATE UNIQUE INDEX "apuracao_snapshots_idempotencyKey_key" ON "apuracao_snapshots"("idempotencyKey");

-- CreateIndex
CREATE INDEX "apuracao_snapshots_estado_idx" ON "apuracao_snapshots"("estado");

-- CreateIndex
CREATE INDEX "apuracao_snapshots_portalClientId_estado_idx" ON "apuracao_snapshots"("portalClientId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "apuracao_snapshots_portalClientId_competencia_key" ON "apuracao_snapshots"("portalClientId", "competencia");

-- CreateIndex
CREATE INDEX "log_decisoes_fator_r_portalClientId_idx" ON "log_decisoes_fator_r"("portalClientId");

-- CreateIndex
CREATE UNIQUE INDEX "log_decisoes_fator_r_portalClientId_competencia_key" ON "log_decisoes_fator_r"("portalClientId", "competencia");

-- CreateIndex
CREATE INDEX "apuracao_batch_jobs_status_iniciadoEm_idx" ON "apuracao_batch_jobs"("status", "iniciadoEm");

-- AddForeignKey
ALTER TABLE "cadastros_fiscais" ADD CONSTRAINT "cadastros_fiscais_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos_servicos" ADD CONSTRAINT "produtos_servicos_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_classificacao" ADD CONSTRAINT "regras_classificacao_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fila_pendencias" ADD CONSTRAINT "fila_pendencias_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apuracao_snapshots" ADD CONSTRAINT "apuracao_snapshots_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_decisoes_fator_r" ADD CONSTRAINT "log_decisoes_fator_r_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "pendencias_pos_fechamento_portalClientId_competencia_resolvida_" RENAME TO "pendencias_pos_fechamento_portalClientId_competencia_resolv_idx";

