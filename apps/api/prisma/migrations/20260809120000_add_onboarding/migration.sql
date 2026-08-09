-- ONBOARDING — funil pré-cadastro de cliente novo (Fase 1, lado do escritório).
--
-- ⚠ NADA É REMOVIDO E NENHUMA TABELA EXISTENTE É ALTERADA. São duas tabelas novas e duas FKs
-- saindo delas. `portal_clients` NÃO ganha coluna: a contraparte `PortalClient.onboarding` do
-- schema é uma relação virtual do Prisma, e a chave estrangeira mora em `onboardings.portalClientId`.
-- (`scripts/validate-migrations.js` reprova remoção de tabela ou de coluna — não há nenhuma aqui,
--  e o texto deste comentário evita até citar os comandos, porque a auditoria casa por regex no
--  arquivo inteiro e um comentário bem-intencionado já reprovaria a migration.)
--
-- ⚠ `onboardings.cnpj` é NULLABLE e SEM UNIQUE, ao contrário de `PortalClient.cnpj`. É a razão de
-- a tabela existir: abertura de empresa não tem CNPJ, e o modelo atual não admite empresa
-- provisória. O unique real continua sendo o de `PortalClient`, cobrado só na conversão.
--
-- ⚠ A FK para `PortalClient` é ON DELETE SET NULL, nunca CASCADE: excluir a empresa não pode
-- apagar o RASTRO de como ela entrou na carteira. Perde-se o ponteiro, não o histórico.
-- A FK de `onboarding_etapas` é CASCADE porque a checklist não tem vida própria — ela é do
-- onboarding.

-- CreateTable
CREATE TABLE "onboardings" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "origemPreenchimento" TEXT NOT NULL DEFAULT 'ESCRITORIO',
    "cnpj" TEXT,
    "razaoSocial" TEXT,
    "responsavelNome" TEXT,
    "responsavelEmail" TEXT,
    "responsavelTelefone" TEXT,
    "emailJaCadastrado" BOOLEAN NOT NULL DEFAULT false,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "ultimoPasso" TEXT,
    "enviadoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,
    "portalClientId" TEXT,
    "convertidoEm" TIMESTAMP(3),
    "convertidoPorId" TEXT,
    "desistiuEm" TIMESTAMP(3),
    "motivoDesistencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboardings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_etapas" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL,
    "acao" TEXT,
    "obrigatoria" BOOLEAN NOT NULL DEFAULT true,
    "concluidaEm" TIMESTAMP(3),
    "concluidaPorId" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_etapas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboardings_portalClientId_key" ON "onboardings"("portalClientId");

-- CreateIndex
CREATE INDEX "onboardings_status_origem_idx" ON "onboardings"("status", "origem");

-- CreateIndex
CREATE INDEX "onboardings_cnpj_idx" ON "onboardings"("cnpj");

-- CreateIndex
CREATE INDEX "onboardings_responsavelEmail_idx" ON "onboardings"("responsavelEmail");

-- CreateIndex
-- ⚠ É este unique que torna o "finalizar" REEXECUTÁVEL: `createMany(..., skipDuplicates: true)`
-- repetido não duplica a checklist de quem clicou duas vezes.
CREATE UNIQUE INDEX "onboarding_etapas_onboardingId_chave_key" ON "onboarding_etapas"("onboardingId", "chave");

-- CreateIndex
CREATE INDEX "onboarding_etapas_onboardingId_ordem_idx" ON "onboarding_etapas"("onboardingId", "ordem");

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_portalClientId_fkey" FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_etapas" ADD CONSTRAINT "onboarding_etapas_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
