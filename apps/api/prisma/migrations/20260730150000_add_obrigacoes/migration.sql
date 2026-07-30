-- Controle de Obrigações: o serviço que o escritório precisa fazer até uma data.
-- Não se relaciona com Guide: guia é o pagamento do cliente, com vencimento próprio.
-- Sem catálogo pré-carregado — quem cadastra obrigação é o contador.

-- CreateTable
CREATE TABLE "obrigacoes" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT,
    "periodicidade" TEXT NOT NULL,
    "diaVencimento" INTEGER NOT NULL,
    "mesReferencia" INTEGER,
    "antecedenciaLembreteDias" INTEGER NOT NULL DEFAULT 5,
    "ajusteDiaUtil" TEXT NOT NULL DEFAULT 'ANTECIPAR',
    "cor" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "verificador" TEXT,
    "regraId" TEXT,
    "sobrescritaLocal" BOOLEAN NOT NULL DEFAULT false,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obrigacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocorrencias_obrigacao" (
    "id" TEXT NOT NULL,
    "obrigacaoId" TEXT NOT NULL,
    "dataVencimento" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "concluidaEm" TIMESTAMP(3),
    "concluidaPorId" TEXT,
    "fonteConclusao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocorrencias_obrigacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regras_obrigacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT,
    "periodicidade" TEXT NOT NULL,
    "diaVencimento" INTEGER NOT NULL,
    "mesReferencia" INTEGER,
    "antecedenciaLembreteDias" INTEGER NOT NULL DEFAULT 5,
    "ajusteDiaUtil" TEXT NOT NULL DEFAULT 'ANTECIPAR',
    "cor" TEXT,
    "verificador" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "escopo" TEXT NOT NULL,
    "filtros" JSONB,
    "aplicarANovas" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regras_obrigacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regras_obrigacao_excecoes" (
    "id" TEXT NOT NULL,
    "regraId" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regras_obrigacao_excecoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feriados" (
    "id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "abrangencia" TEXT NOT NULL,
    "municipio" TEXT,
    "nome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feriados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "obrigacoes_portalClientId_ativa_idx" ON "obrigacoes"("portalClientId", "ativa");

-- CreateIndex
CREATE INDEX "obrigacoes_regraId_idx" ON "obrigacoes"("regraId");

-- CreateIndex
CREATE INDEX "ocorrencias_obrigacao_dataVencimento_status_idx" ON "ocorrencias_obrigacao"("dataVencimento", "status");

-- CreateIndex
-- Idempotência da geração: reexecutar a janela de 12 meses não duplica ocorrência.
CREATE UNIQUE INDEX "ocorrencias_obrigacao_obrigacaoId_dataVencimento_key" ON "ocorrencias_obrigacao"("obrigacaoId", "dataVencimento");

-- CreateIndex
CREATE INDEX "regras_obrigacao_ativa_idx" ON "regras_obrigacao"("ativa");

-- CreateIndex
CREATE UNIQUE INDEX "regras_obrigacao_excecoes_regraId_portalClientId_key" ON "regras_obrigacao_excecoes"("regraId", "portalClientId");

-- CreateIndex
CREATE INDEX "feriados_data_idx" ON "feriados"("data");

-- CreateIndex
CREATE UNIQUE INDEX "feriados_data_abrangencia_municipio_key" ON "feriados"("data", "abrangencia", "municipio");

-- AddForeignKey
ALTER TABLE "obrigacoes" ADD CONSTRAINT "obrigacoes_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obrigacoes" ADD CONSTRAINT "obrigacoes_regraId_fkey" FOREIGN KEY ("regraId") REFERENCES "regras_obrigacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencias_obrigacao" ADD CONSTRAINT "ocorrencias_obrigacao_obrigacaoId_fkey" FOREIGN KEY ("obrigacaoId") REFERENCES "obrigacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_obrigacao_excecoes" ADD CONSTRAINT "regras_obrigacao_excecoes_regraId_fkey" FOREIGN KEY ("regraId") REFERENCES "regras_obrigacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
