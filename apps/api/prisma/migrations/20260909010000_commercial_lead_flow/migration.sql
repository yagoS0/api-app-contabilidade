-- AlterTable
ALTER TABLE "mensagens_whatsapp" ADD COLUMN     "referenciaComercial" JSONB;

-- AlterTable
ALTER TABLE "turnos_ia_whatsapp" ADD COLUMN     "perfil" TEXT NOT NULL DEFAULT 'CLIENTE';

-- AlterTable
ALTER TABLE "onboardings" ADD COLUMN     "fontesDados" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "atendimentos_lead" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "onboardingId" TEXT,
    "triagem" JSONB NOT NULL DEFAULT '{}',
    "representanteVerificadoEm" TIMESTAMP(3),
    "representanteVerificadoPor" TEXT,
    "evidenciaRepresentante" TEXT,
    "autorizacao" JSONB NOT NULL DEFAULT '{}',
    "encerradoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "atendimentos_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recursos_comerciais" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "texto" TEXT NOT NULL DEFAULT '',
    "dados" JSONB NOT NULL DEFAULT '{}',
    "aprovadoEm" TIMESTAMP(3),
    "aprovadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recursos_comerciais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propostas_comerciais" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "fichaVersao" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "aprovadaEm" TIMESTAMP(3),
    "aprovadaPor" TEXT,
    "enviadaEm" TIMESTAMP(3),
    "aceitaEm" TIMESTAMP(3),
    "opcaoAceita" TEXT,
    "aceiteEvidencia" TEXT,
    "tokenHash" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "propostas_comerciais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratos_comerciais" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "propostaId" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MINUTA',
    "aprovadoPor" TEXT,
    "aprovadoEm" TIMESTAMP(3),
    "documentoAssinadoId" TEXT,
    "assinaturaConferidaPor" TEXT,
    "assinaturaConferidaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contratos_comerciais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_onboarding" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "conteudoCifrado" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "criadoPor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trabalhos_fiscais_lead" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseAte" TIMESTAMP(3),
    "reservaToken" TEXT,
    "resultado" JSONB NOT NULL DEFAULT '{}',
    "criadoPor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trabalhos_fiscais_lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "atendimentos_lead_conversaId_encerradoEm_idx" ON "atendimentos_lead"("conversaId", "encerradoEm");

-- CreateIndex
CREATE INDEX "atendimentos_lead_onboardingId_idx" ON "atendimentos_lead"("onboardingId");

-- CreateIndex
CREATE UNIQUE INDEX "recursos_comerciais_tipo_chave_versao_key" ON "recursos_comerciais"("tipo", "chave", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "propostas_comerciais_tokenHash_key" ON "propostas_comerciais"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "propostas_comerciais_onboardingId_versao_key" ON "propostas_comerciais"("onboardingId", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "contratos_comerciais_propostaId_key" ON "contratos_comerciais"("propostaId");

-- CreateIndex
CREATE UNIQUE INDEX "contratos_comerciais_documentoAssinadoId_key" ON "contratos_comerciais"("documentoAssinadoId");

-- CreateIndex
CREATE INDEX "documentos_onboarding_onboardingId_idx" ON "documentos_onboarding"("onboardingId");

-- CreateIndex
CREATE INDEX "trabalhos_fiscais_lead_status_proximaTentativaEm_idx" ON "trabalhos_fiscais_lead"("status", "proximaTentativaEm");

-- AddForeignKey
ALTER TABLE "atendimentos_lead" ADD CONSTRAINT "atendimentos_lead_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimentos_lead" ADD CONSTRAINT "atendimentos_lead_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "onboardings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas_comerciais" ADD CONSTRAINT "propostas_comerciais_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "onboardings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos_comerciais" ADD CONSTRAINT "contratos_comerciais_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "onboardings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos_comerciais" ADD CONSTRAINT "contratos_comerciais_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "propostas_comerciais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_onboarding" ADD CONSTRAINT "documentos_onboarding_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "onboardings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trabalhos_fiscais_lead" ADD CONSTRAINT "trabalhos_fiscais_lead_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "onboardings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active case per conversation, while preserving completed history.
CREATE UNIQUE INDEX "atendimentos_lead_conversa_ativa" ON "atendimentos_lead" ("conversaId") WHERE "encerradoEm" IS NULL;
CREATE UNIQUE INDEX "trabalhos_fiscais_lead_ativo" ON "trabalhos_fiscais_lead" ("onboardingId", "cnpj", "tipo") WHERE "status" IN ('PENDENTE', 'PROCESSANDO', 'AGUARDANDO');
